'use strict';

/**
 * Paiements sortants FedaPay — flux métier ET sécurité. FedaPay est simulé en interceptant `fetch` pour son domaine
 * uniquement (les appels vers le serveur de test local passent normalement).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const { encryptSecret } = require('../src/utils/encryption');
const { createFixture, createBareFixture, teardown } = require('./gl/fixtures');
const { verifyAuditChain } = require('../src/services/payments/audit');
const { runPaymentStatusJob } = require('../src/jobs/paymentStatusJob');
const { escapeHtml, safeHeader } = require('../src/services/email/sendEmail');

const PASSWORD = 'Mot-de-passe-Test-42';
let A; // cabinet avec paiements activés + comptabilité avancée
let B; // autre cabinet (isolation) avec paiements activés
let comptableId;
let server;
let baseUrl;
const realFetch = global.fetch;
const payouts = new Map(); // id → { status, amount }
let nextPayoutId = 9000;
let fedapayCalls = [];

function installFedaPayMock() {
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('fedapay.com')) return realFetch(url, init);
    const path = new URL(u).pathname;
    fedapayCalls.push({ method: init.method, path, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null });
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
    if (init.method === 'POST' && path === '/v1/payouts') {
      const body = JSON.parse(init.body);
      const id = nextPayoutId++;
      payouts.set(String(id), { status: 'pending', amount: body.amount });
      return json({ 'v1/payout': { id, status: 'pending', amount: body.amount } });
    }
    if (init.method === 'PUT' && path === '/v1/payouts/start') {
      const id = String(JSON.parse(init.body).payouts[0].id);
      payouts.get(id).status = 'started';
      return json({ 'v1/payouts': [{ id: Number(id), status: 'started' }] });
    }
    const m = path.match(/^\/v1\/payouts\/(\d+)$/);
    if (init.method === 'GET' && m) {
      const p = payouts.get(m[1]);
      return json({ 'v1/payout': { id: Number(m[1]), status: p.status, amount: p.amount } });
    }
    return json({ message: 'inconnu' }, 404);
  };
}

async function makeDg(tenantId, label) {
  const hash = await hashPassword(PASSWORD);
  const [r] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, email, password_hash) VALUES (:t, 'dg', :l, 'Dg', :phone, :email, :hash)",
    { t: tenantId, l: label, phone: `07${Math.floor(Math.random() * 100000000)}`, email: `${label.toLowerCase()}${Date.now()}@example.test`, hash },
  );
  return r.insertId;
}

async function enable(tenantId) {
  await pool.query(
    'UPDATE tenants SET fedapay_enabled = 1, fedapay_sandbox = 1, fedapay_secret_key_enc = :k, payments_per_order_limit = 500000, payments_daily_limit = 2000000 WHERE id = :t',
    { k: encryptSecret('sk_sandbox_SECRET_VALUE_123'), t: tenantId },
  );
}

before(async () => {
  A = await createFixture();
  B = await createBareFixture();
  A.dgId2 = await makeDg(A.tenantId, 'Dga');
  A.dgId3 = await makeDg(A.tenantId, 'Dgb'); // utilisé pour le test de verrouillage
  B.dgId2 = await makeDg(B.tenantId, 'Dgc');
  await enable(A.tenantId);
  await enable(B.tenantId);
  const [r] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'comptable', 'Awa', 'Kpakpo', :phone, 'x')",
    { t: A.tenantId, phone: `06${Math.floor(Math.random() * 100000000)}` },
  );
  comptableId = r.insertId;
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  installFedaPayMock();
});

after(async () => {
  global.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
  for (const fx of [A, B]) {
    await pool.query('DELETE el FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id WHERE e.tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM gl_entries WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM payslips WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM owner_payouts WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM expenses WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM payment_reauth_state WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :t)', { t: fx.tenantId });
    await pool.query('DELETE FROM payment_orders WHERE tenant_id = :t', { t: fx.tenantId });
    await teardown(fx.tenantId);
  }
  await closePool();
});

const auth = (id, tenantId, role = 'dg') => ({ Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`, 'Content-Type': 'application/json' });
const key = () => `k${Date.now()}${Math.random().toString(36).slice(2, 12)}`.slice(0, 40).padEnd(16, 'x');
const freeOrder = (over = {}) => ({
  purpose: 'autre', beneficiaryName: 'Plombier Test', amount: 25000, label: 'Réparation fuite', phone: '97 00 11 22',
  operator: 'mtn', password: PASSWORD, idempotencyKey: key(), ...over,
});
const post = (fx, userId, body, role = 'dg') => fetch(`${baseUrl}/api/payments/orders`, { method: 'POST', headers: auth(userId, fx.tenantId, role), body: JSON.stringify(body) });

test('authentification et rôle : sans jeton 401, comptable ne peut pas envoyer (403) mais peut lire', async () => {
  assert.equal((await fetch(`${baseUrl}/api/payments/orders`)).status, 401);
  assert.equal((await post(A, comptableId, freeOrder(), 'comptable')).status, 403);
  const list = await fetch(`${baseUrl}/api/payments/orders`, { headers: auth(comptableId, A.tenantId, 'comptable') });
  assert.equal(list.status, 200);
});

test('paiements non activés : refus 403 sans appel au prestataire', async () => {
  const C = await createBareFixture();
  const dg = await makeDg(C.tenantId, 'Dgd');
  fedapayCalls = [];
  const res = await post(C, dg, freeOrder());
  assert.equal(res.status, 403);
  assert.equal(fedapayCalls.length, 0);
  await pool.query('DELETE FROM payment_reauth_state WHERE user_id = :u', { u: dg });
  await teardown(C.tenantId);
});

test('validation stricte : champ inconnu, clé d\'idempotence absente/invalide, montant négatif, opérateur inconnu → 400', async () => {
  for (const bad of [
    freeOrder({ extra: 'x' }),
    freeOrder({ idempotencyKey: undefined }),
    freeOrder({ idempotencyKey: 'court' }),
    freeOrder({ amount: -5 }),
    freeOrder({ amount: 10.5 }),
    freeOrder({ operator: 'orange' }),
    freeOrder({ purpose: 'virement' }),
  ]) {
    const res = await post(A, A.dgId2, bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    const text = await res.text();
    assert.ok(!text.includes(PASSWORD), 'le mot de passe ne doit jamais être renvoyé');
  }
});

test('mauvais mot de passe → 403 générique, aucun appel FedaPay, échec tracé dans l\'audit', async () => {
  fedapayCalls = [];
  const res = await post(A, A.dgId2, freeOrder({ password: 'faux' }));
  assert.equal(res.status, 403);
  assert.equal(fedapayCalls.length, 0);
  const [ev] = await pool.query("SELECT id FROM payment_audit_events WHERE tenant_id = :t AND event_type = 'reauth_failed'", { t: A.tenantId });
  assert.ok(ev.length >= 1);
});

test('verrouillage après 5 mauvais mots de passe : le 6e (même correct) est refusé 429', async () => {
  for (let i = 0; i < 5; i += 1) assert.equal((await post(A, A.dgId3, freeOrder({ password: 'faux' }))).status, 403);
  const res = await post(A, A.dgId3, freeOrder());
  assert.equal(res.status, 429);
});

test('flux complet : création → processing, effet métier SEULEMENT après confirmation serveur, un seul rejeu', async () => {
  fedapayCalls = [];
  const body = freeOrder();
  const res = await post(A, A.dgId2, body);
  assert.equal(res.status, 201);
  const { order } = await res.json();
  assert.equal(order.status, 'processing');
  assert.equal(order.applied, false);
  assert.ok(!JSON.stringify(order).includes('97001122'), 'numéro complet jamais renvoyé');
  assert.ok(order.beneficiaryPhoneMasked.includes('••••'));
  assert.ok(!('idempotencyKey' in order) && !('idempotency_key' in order));
  assert.equal(fedapayCalls.filter((c) => c.method === 'POST').length, 1);
  assert.equal(fedapayCalls[0].auth, 'Bearer sk_sandbox_SECRET_VALUE_123');

  // Aucune dépense tant que FedaPay n'a pas confirmé.
  let [exp] = await pool.query("SELECT id FROM expenses WHERE tenant_id = :t AND label = 'Réparation fuite'", { t: A.tenantId });
  assert.equal(exp.length, 0);

  // Statut encore « started » chez FedaPay : rien ne change.
  let r = await fetch(`${baseUrl}/api/payments/orders/${order.id}/refresh`, { method: 'POST', headers: auth(A.dgId2, A.tenantId) });
  assert.equal((await r.json()).order.status, 'processing');

  // Rejeu avec la même clé : 200, même ordre, pas de nouvel appel prestataire.
  const before = fedapayCalls.length;
  const replay = await post(A, A.dgId2, body);
  assert.equal(replay.status, 200);
  const replayJson = await replay.json();
  assert.equal(replayJson.order.id, order.id);
  assert.equal(replayJson.replayed, true);
  assert.equal(fedapayCalls.length, before);

  // FedaPay confirme → appliqué UNE fois (deux refresh successifs).
  const [[row]] = await pool.query('SELECT fedapay_payout_id FROM payment_orders WHERE id = :id', { id: order.id });
  payouts.get(row.fedapay_payout_id).status = 'sent';
  r = await fetch(`${baseUrl}/api/payments/orders/${order.id}/refresh`, { method: 'POST', headers: auth(A.dgId2, A.tenantId) });
  const done = (await r.json()).order;
  assert.equal(done.status, 'sent');
  assert.equal(done.applied, true);
  await fetch(`${baseUrl}/api/payments/orders/${order.id}/refresh`, { method: 'POST', headers: auth(A.dgId2, A.tenantId) });
  [exp] = await pool.query("SELECT id FROM expenses WHERE tenant_id = :t AND label = 'Réparation fuite'", { t: A.tenantId });
  assert.equal(exp.length, 1, 'effet métier appliqué exactement une fois');

  // Avis PDF disponible, et seulement pour un ordre envoyé.
  const pdf = await fetch(`${baseUrl}/api/payments/orders/${order.id}/advice.pdf`, { headers: auth(A.dgId2, A.tenantId) });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal((await pdf.arrayBuffer()).byteLength > 500, true);

  // Journal : chaîne intègre, puis altération détectée.
  assert.deepEqual((await verifyAuditChain(A.tenantId)).ok, true);
  const [[ev]] = await pool.query("SELECT id FROM payment_audit_events WHERE tenant_id = :t AND event_type = 'order_created' ORDER BY id DESC LIMIT 1", { t: A.tenantId });
  await pool.query("UPDATE payment_audit_events SET details = '{\"amount\":1}' WHERE id = :id", { id: ev.id });
  const broken = await verifyAuditChain(A.tenantId);
  assert.equal(broken.ok, false);
  assert.equal(broken.brokenAtId, ev.id);
});

test("l'avis PDF est refusé tant que l'envoi n'est pas confirmé (409)", async () => {
  const { order } = await (await post(A, A.dgId2, freeOrder({ label: 'Pas encore envoyé' }))).json();
  const pdf = await fetch(`${baseUrl}/api/payments/orders/${order.id}/advice.pdf`, { headers: auth(A.dgId2, A.tenantId) });
  assert.equal(pdf.status, 409);
});

test('montant confirmé ≠ montant demandé : anomalie, rien n\'est enregistré', async () => {
  const { order } = await (await post(A, A.dgId2, freeOrder({ label: 'Montant suspect', amount: 10000 }))).json();
  const [[row]] = await pool.query('SELECT fedapay_payout_id FROM payment_orders WHERE id = :id', { id: order.id });
  const remote = payouts.get(row.fedapay_payout_id);
  remote.status = 'sent';
  remote.amount = 99999;
  const r = await fetch(`${baseUrl}/api/payments/orders/${order.id}/refresh`, { method: 'POST', headers: auth(A.dgId2, A.tenantId) });
  const after = (await r.json()).order;
  assert.equal(after.status, 'processing');
  assert.equal(after.applied, false);
  assert.match(after.failureReason, /ANOMALIE/);
  const [exp] = await pool.query("SELECT id FROM expenses WHERE tenant_id = :t AND label = 'Montant suspect'", { t: A.tenantId });
  assert.equal(exp.length, 0);
});

test('échec côté prestataire → failed, aucun effet métier', async () => {
  const { order } = await (await post(A, A.dgId2, freeOrder({ label: 'Echec prestataire' }))).json();
  const [[row]] = await pool.query('SELECT fedapay_payout_id FROM payment_orders WHERE id = :id', { id: order.id });
  payouts.get(row.fedapay_payout_id).status = 'failed';
  const r = await fetch(`${baseUrl}/api/payments/orders/${order.id}/refresh`, { method: 'POST', headers: auth(A.dgId2, A.tenantId) });
  assert.equal((await r.json()).order.status, 'failed');
  const [exp] = await pool.query("SELECT id FROM expenses WHERE tenant_id = :t AND label = 'Echec prestataire'", { t: A.tenantId });
  assert.equal(exp.length, 0);
});

test('le job de suivi fait avancer les ordres en cours', async () => {
  const { order } = await (await post(A, A.dgId2, freeOrder({ label: 'Via job' }))).json();
  const [[row]] = await pool.query('SELECT fedapay_payout_id FROM payment_orders WHERE id = :id', { id: order.id });
  payouts.get(row.fedapay_payout_id).status = 'sent';
  await pool.query('UPDATE payment_orders SET created_at = (NOW() - INTERVAL 5 MINUTE) WHERE id = :id', { id: order.id });
  const out = await runPaymentStatusJob({ tenantIds: [A.tenantId] });
  assert.ok(out.advanced >= 1);
  const [[after]] = await pool.query('SELECT status, applied_at FROM payment_orders WHERE id = :id', { id: order.id });
  assert.equal(after.status, 'sent');
  assert.ok(after.applied_at);
});

test('plafond par ordre et plafond journalier', async () => {
  const over = await post(A, A.dgId2, freeOrder({ amount: 500001 }));
  assert.equal(over.status, 422);
  await pool.query('UPDATE tenants SET payments_daily_limit = 1000 WHERE id = :t', { t: A.tenantId });
  const day = await post(A, A.dgId2, freeOrder({ amount: 5000 }));
  assert.equal(day.status, 422);
  await pool.query('UPDATE tenants SET payments_daily_limit = 2000000 WHERE id = :t', { t: A.tenantId });
});

test('numéro invalide refusé (422) sans appel prestataire', async () => {
  fedapayCalls = [];
  const res = await post(A, A.dgId2, freeOrder({ phone: '+33 6 12 34 56 78' }));
  assert.equal(res.status, 422);
  assert.equal(fedapayCalls.length, 0);
});

test('reversement propriétaire : refusé au-delà du solde séquestre ; propriétaire d\'un autre cabinet introuvable', async () => {
  const over = await post(A, A.dgId2, {
    purpose: 'reversement_proprietaire', ownerId: A.ownerId, amount: 400000, periodLabel: 'Octobre 2026',
    phone: '97001122', operator: 'mtn', password: PASSWORD, idempotencyKey: key(),
  });
  assert.equal(over.status, 422);
  const foreign = await post(B, B.dgId2, {
    purpose: 'reversement_proprietaire', ownerId: A.ownerId, amount: 1000, periodLabel: 'Octobre 2026',
    phone: '97001122', operator: 'mtn', password: PASSWORD, idempotencyKey: key(),
  });
  assert.equal(foreign.status, 404);
});

test('salaire : employé d\'un autre cabinet introuvable (IDOR) ; salaire valide → fiche créée après confirmation', async () => {
  const foreign = await post(B, B.dgId2, {
    purpose: 'salaire', userId: A.comptable?.id ?? comptableId, period: '2026-10', baseAmount: 100000,
    phone: '97001122', operator: 'moov', password: PASSWORD, idempotencyKey: key(),
  });
  assert.equal(foreign.status, 404);

  const ok = await post(A, A.dgId2, {
    purpose: 'salaire', userId: comptableId, period: '2026-10', baseAmount: 100000, bonusAmount: 5000, deductionAmount: 2000,
    phone: '97001122', operator: 'moov', password: PASSWORD, idempotencyKey: key(),
  });
  assert.equal(ok.status, 201);
  const { order } = await ok.json();
  assert.equal(order.amount, 103000);
  const [[row]] = await pool.query('SELECT fedapay_payout_id FROM payment_orders WHERE id = :id', { id: order.id });
  payouts.get(row.fedapay_payout_id).status = 'sent';
  await fetch(`${baseUrl}/api/payments/orders/${order.id}/refresh`, { method: 'POST', headers: auth(A.dgId2, A.tenantId) });
  const [slips] = await pool.query("SELECT net_amount FROM payslips WHERE tenant_id = :t AND user_id = :u AND period = '2026-10'", { t: A.tenantId, u: comptableId });
  assert.equal(slips.length, 1);
  assert.equal(Number(slips[0].net_amount), 103000);
  // Même période une 2e fois : refusé.
  const dup = await post(A, A.dgId2, {
    purpose: 'salaire', userId: comptableId, period: '2026-10', baseAmount: 100000,
    phone: '97001122', operator: 'moov', password: PASSWORD, idempotencyKey: key(),
  });
  assert.equal(dup.status, 409);
});

test('isolation entre cabinets : liste, détail, refresh, avis et retry invisibles pour un autre cabinet', async () => {
  const { order } = await (await post(A, A.dgId2, freeOrder({ label: 'Privé A' }))).json();
  const list = await (await fetch(`${baseUrl}/api/payments/orders?limit=100`, { headers: auth(B.dgId2, B.tenantId) })).json();
  assert.equal(list.orders.some((o) => o.id === order.id), false);
  for (const [method, path] of [
    ['GET', `/orders/${order.id}`], ['POST', `/orders/${order.id}/refresh`],
    ['GET', `/orders/${order.id}/advice.pdf`], ['POST', `/orders/${order.id}/retry-apply`],
  ]) {
    const res = await fetch(`${baseUrl}/api/payments${path}`, { method, headers: auth(B.dgId2, B.tenantId) });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  // Même clé d'idempotence dans un autre cabinet : pas de collision ni de fuite.
  const sameKey = key();
  const a = await post(A, A.dgId2, freeOrder({ idempotencyKey: sameKey, label: 'Clé A' }));
  const b = await post(B, B.dgId2, freeOrder({ idempotencyKey: sameKey, label: 'Clé B' }));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual((await a.json()).order.id, (await b.json()).order.id);
});

test('injection SQL : filtres rejetés (400), charges utiles stockées comme simples données', async () => {
  for (const q of ["status=' OR 1=1 --", "purpose=autre'; DROP TABLE payment_orders;--", "from=2026-01-01' OR '1'='1", 'limit=1;SELECT SLEEP(5)', 'offset=-1']) {
    const res = await fetch(`${baseUrl}/api/payments/orders?${q}`, { headers: auth(A.dgId2, A.tenantId) });
    assert.equal(res.status, 400, q);
  }
  for (const bad of ['abc', '1 OR 1=1', '1;DROP TABLE users', '-1', '0']) {
    const res = await fetch(`${baseUrl}/api/payments/orders/${encodeURIComponent(bad)}`, { headers: auth(A.dgId2, A.tenantId) });
    assert.equal(res.status, 404, bad);
  }
  const payload = "'); DROP TABLE users; -- <script>alert(1)</script>";
  const res = await post(A, A.dgId2, freeOrder({ label: payload, beneficiaryName: payload.slice(0, 90) }));
  assert.equal(res.status, 201);
  const [[stored]] = await pool.query('SELECT label FROM payment_orders WHERE tenant_id = :t AND label = :l', { t: A.tenantId, l: payload });
  assert.equal(stored.label, payload);
  const [[u]] = await pool.query('SELECT COUNT(*) AS n FROM users WHERE tenant_id = :t', { t: A.tenantId });
  assert.ok(u.n >= 1);
});

test('aucun secret ne sort : paramètres, ordres, détails et erreurs ne contiennent jamais la clé FedaPay', async () => {
  const settings = await (await fetch(`${baseUrl}/api/settings`, { headers: auth(A.dgId2, A.tenantId) })).text();
  assert.ok(!settings.includes('sk_sandbox_SECRET_VALUE_123'));
  assert.ok(!/fedapay_secret_key_enc|fedapaySecretKey"/.test(settings));
  const parsed = JSON.parse(settings);
  assert.equal(parsed.settings.fedapayConfigured, true);
  for (const path of ['/summary', '/orders', '/audit/verify']) {
    const text = await (await fetch(`${baseUrl}/api/payments${path}`, { headers: auth(A.dgId2, A.tenantId) })).text();
    assert.ok(!text.includes('sk_sandbox_SECRET_VALUE_123'), path);
    assert.ok(!text.includes('97001122'), path);
  }
  const [events] = await pool.query('SELECT details FROM payment_audit_events WHERE tenant_id = :t', { t: A.tenantId });
  for (const e of events) {
    assert.ok(!String(e.details).includes('sk_sandbox'), 'audit sans secret');
    assert.ok(!String(e.details).includes(PASSWORD), 'audit sans mot de passe');
    assert.ok(!String(e.details).includes('97001122'), 'audit sans numéro complet');
  }
});

test('e-mail : échappement HTML et neutralisation de l\'injection d\'en-tête', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>"&\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;');
  const subject = safeHeader('Paiement\r\nBcc: attaquant@evil.test');
  assert.ok(!/[\r\n]/.test(subject));
});

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('loyer encaissé : e-mail automatique au locataire (adresse masquée dans le journal), "ignoré" sans adresse', async () => {
  await pool.query("UPDATE renters SET email = 'locataire.secret@example.test' WHERE id = :id", { id: A.renterId });
  const res = await fetch(`${baseUrl}/api/leases/${A.leaseId}/payments`, {
    method: 'POST', headers: auth(A.dgId2, A.tenantId),
    body: JSON.stringify({ amount: 50000, paymentMethod: 'especes', paidAt: '2026-03-05' }),
  });
  assert.equal(res.status, 201);
  const { paymentId } = await res.json();
  const row = await waitFor(async () => (await pool.query(
    "SELECT recipient_masked, recipient_role, status FROM payment_notifications WHERE tenant_id = :t AND source_table = 'rent_payments' AND source_id = :id",
    { t: A.tenantId, id: paymentId },
  ))[0][0]);
  assert.ok(row, 'une notification doit être journalisée');
  assert.equal(row.recipient_role, 'payer');
  assert.ok(!row.recipient_masked.includes('locataire.secret'), 'adresse jamais en clair dans le journal');
  assert.ok(row.recipient_masked.endsWith('@example.test'));

  await pool.query('UPDATE renters SET email = NULL WHERE id = :id', { id: A.renterId });
  const res2 = await fetch(`${baseUrl}/api/leases/${A.leaseId}/payments`, {
    method: 'POST', headers: auth(A.dgId2, A.tenantId),
    body: JSON.stringify({ amount: 50000, paymentMethod: 'especes', paidAt: '2026-04-05' }),
  });
  assert.equal(res2.status, 201);
  const { paymentId: p2 } = await res2.json();
  const row2 = await waitFor(async () => (await pool.query(
    "SELECT status FROM payment_notifications WHERE tenant_id = :t AND source_table = 'rent_payments' AND source_id = :id",
    { t: A.tenantId, id: p2 },
  ))[0][0]);
  assert.equal(row2.status, 'skipped');
});

test('charges payées : reçu téléchargeable par le locataire (portail), e-mail automatique, isolation du lien', async () => {
  await pool.query("UPDATE renters SET email = 'loc.charges@example.test' WHERE id = :id", { id: A.renterId });
  const [ch] = await pool.query(
    `INSERT INTO utility_charges (tenant_id, lease_id, utility_type, reading_start, reading_end, unit_price, amount, loss_share_amount, billed_at, period_start, period_end, recorded_by)
     VALUES (:t, :l, 'sbee', 0, 120, 100, 12000, 0, '2026-03-31', '2026-03-01', '2026-03-31', :by)`,
    { t: A.tenantId, l: A.leaseId, by: A.dgId },
  );
  const pay = await fetch(`${baseUrl}/api/charges/${ch.insertId}/payments`, {
    method: 'POST', headers: auth(A.dgId2, A.tenantId),
    body: JSON.stringify({ amount: 12000, paymentMethod: 'especes', paidAt: '2026-04-02', idempotencyKey: key() }),
  });
  assert.equal(pay.status, 201);
  const [[up]] = await pool.query('SELECT id FROM utility_payments WHERE charge_id = :c', { c: ch.insertId });
  const notif = await waitFor(async () => (await pool.query(
    "SELECT recipient_masked FROM payment_notifications WHERE tenant_id = :t AND source_table = 'utility_payments' AND source_id = :id",
    { t: A.tenantId, id: up.id },
  ))[0][0]);
  assert.ok(notif && !notif.recipient_masked.includes('loc.charges'));

  const link = await (await fetch(`${baseUrl}/api/renters/${A.renterId}/portal-link`, { method: 'POST', headers: auth(A.dgId2, A.tenantId) })).json();
  const dash = await (await fetch(`${baseUrl}/api/portal/${link.token}`)).json();
  assert.ok(dash.chargePayments.some((c) => c.id === up.id));
  const pdf = await fetch(`${baseUrl}/api/portal/${link.token}/charge-payments/${up.id}/receipt.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');

  // Un autre locataire (autre cabinet) ne peut pas lire ce reçu, même en devinant l'identifiant.
  const [r2] = await pool.query("INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Autre', 'Loc', :p, :by)", { t: B.tenantId, p: `04${Math.floor(Math.random() * 100000000)}`, by: B.dgId });
  const [bu] = await pool.query("INSERT INTO properties (tenant_id, code, owner_id, address, created_by) VALUES (:t, 'B1', :o, 'x', :by)", { t: B.tenantId, o: B.ownerId, by: B.dgId });
  const [un] = await pool.query("INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'U9', 'studio', 'loue', 1000, :by)", { t: B.tenantId, p: bu.insertId, by: B.dgId });
  await pool.query("INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-01-01', 1000, 5, 0, 'active', :by)", { t: B.tenantId, r: r2.insertId, u: un.insertId, by: B.dgId });
  const link2 = await (await fetch(`${baseUrl}/api/renters/${r2.insertId}/portal-link`, { method: 'POST', headers: auth(B.dgId2, B.tenantId) })).json();
  const stolen = await fetch(`${baseUrl}/api/portal/${link2.token}/charge-payments/${up.id}/receipt.pdf`);
  assert.equal(stolen.status, 404);
  const bad = await fetch(`${baseUrl}/api/portal/${link2.token}/charge-payments/1%20OR%201=1/receipt.pdf`);
  assert.equal(bad.status, 400);
  await pool.query('DELETE FROM utility_payments WHERE tenant_id = :t', { t: A.tenantId });
  await pool.query('DELETE FROM utility_charges WHERE tenant_id = :t', { t: A.tenantId });
});
