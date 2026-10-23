'use strict';

/**
 * Encaissement en ligne FedaPay (loyers, charges, liens) — flux et sécurité. FedaPay est simulé via `fetch`.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { encryptSecret } = require('../src/utils/encryption');
const { createFixture, createBareFixture, teardown } = require('./gl/fixtures');

const WEBHOOK_SECRET = 'whsec_test_secret_value';
let A;
let B;
let server;
let baseUrl;
const realFetch = global.fetch;
const txs = new Map(); // id → { status, amount, meta }
let nextTx = 5000;
let calls = [];
let tokenUrl = 'https://sandbox-process.fedapay.com/abc123';

function mock() {
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('fedapay.com') || u.includes('process.fedapay.com')) return realFetch(url, init);
    const path = new URL(u).pathname;
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body });
    if (init.method === 'POST' && path === '/v1/transactions') {
      const id = nextTx++;
      txs.set(String(id), { status: 'pending', amount: body.amount, meta: body.custom_metadata });
      return json({ 'v1/transaction': { id, status: 'pending', amount: body.amount, custom_metadata: body.custom_metadata } });
    }
    let m = path.match(/^\/v1\/transactions\/(\d+)\/token$/);
    if (init.method === 'POST' && m) return json({ token: 'tok', url: tokenUrl });
    m = path.match(/^\/v1\/transactions\/(\d+)$/);
    if (init.method === 'GET' && m) {
      const t = txs.get(m[1]);
      return json({ 'v1/transaction': { id: Number(m[1]), status: t.status, amount: t.amount, custom_metadata: t.meta } });
    }
    return json({ message: 'inconnu' }, 404);
  };
}

before(async () => {
  A = await createFixture();
  B = await createBareFixture();
  for (const fx of [A, B]) {
    await pool.query(
      'UPDATE tenants SET fedapay_collect_enabled = 1, fedapay_sandbox = 1, fedapay_secret_key_enc = :k, fedapay_webhook_secret_enc = :w WHERE id = :t',
      { k: encryptSecret('sk_sandbox_COLLECT_SECRET'), w: encryptSecret(WEBHOOK_SECRET), t: fx.tenantId },
    );
  }
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  mock();
});

after(async () => {
  global.fetch = realFetch;
  await new Promise((r) => server.close(r));
  for (const fx of [A, B]) {
    await pool.query('DELETE el FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id WHERE e.tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM gl_entries WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM receipts WHERE tenant_id = :t', { t: fx.tenantId }).catch(() => {});
    await pool.query('DELETE FROM utility_payments WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM utility_charges WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM payment_links WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM online_payment_intents WHERE tenant_id = :t', { t: fx.tenantId });
    await teardown(fx.tenantId);
  }
  await closePool();
});

const bearer = (id, tenantId) => ({ Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role: 'dg' })}`, 'Content-Type': 'application/json' });

async function portalToken(fx) {
  const res = await fetch(`${baseUrl}/api/renters/${fx.renterId}/portal-link`, { method: 'POST', headers: bearer(fx.dgId, fx.tenantId) });
  return (await res.json()).token;
}
const post = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

async function checkoutRent(token, amount = 50000) {
  const res = await post(`/api/portal/${token}/rent/checkout`, { amount });
  return { res, body: await res.json() };
}
const confirm = async (reference) => (await post('/api/online-payments/confirm', { reference })).json();
async function txOf(reference) {
  const [[row]] = await pool.query('SELECT fedapay_transaction_id AS id FROM online_payment_intents WHERE reference = :r', { r: reference });
  return row.id;
}

test('paiement non activé : refus 400, aucun appel FedaPay', async () => {
  const C = await createBareFixture();
  const t = await (await fetch(`${baseUrl}/api/renters/${C.renterId}/portal-link`, { method: 'POST', headers: bearer(C.dgId, C.tenantId) })).json();
  calls = [];
  const res = await post(`/api/portal/${t.token}/rent/checkout`, { amount: 50000 });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
  await teardown(C.tenantId);
});

test('loyer : redirection FedaPay créée côté serveur, montant borné, clé jamais exposée', async () => {
  const token = await portalToken(A);
  for (const bad of [0, 99, -5, 10.5, 'abc', 50000 * 13, null]) {
    const r = await post(`/api/portal/${token}/rent/checkout`, { amount: bad });
    assert.equal(r.status, 400, String(bad));
  }
  calls = [];
  const { res, body } = await checkoutRent(token);
  assert.equal(res.status, 200);
  assert.match(body.reference, /^[a-f0-9]{32}$/);
  assert.ok(body.url.startsWith('https://sandbox-process.fedapay.com/'));
  assert.ok(!JSON.stringify(body).includes('sk_sandbox'));
  const create = calls.find((c) => c.path === '/v1/transactions');
  assert.equal(create.body.amount, 50000);
  assert.equal(create.body.custom_metadata.lyko_reference, body.reference);
  assert.ok(create.body.callback_url.includes(`/paiement/retour?ref=${body.reference}`));
});

test('adresse de paiement non FedaPay refusée (502), intention marquée échouée', async () => {
  const token = await portalToken(A);
  tokenUrl = 'https://evil.example.com/pay';
  const { res } = await checkoutRent(token);
  tokenUrl = 'https://sandbox-process.fedapay.com/abc123';
  assert.equal(res.status, 502);
  const [[row]] = await pool.query("SELECT status FROM online_payment_intents WHERE tenant_id = :t ORDER BY id DESC LIMIT 1", { t: A.tenantId });
  assert.equal(row.status, 'failed');
});

test('retour client : en attente → rien ; approuvé → enregistré UNE fois ; rejeu sans doublon', async () => {
  const token = await portalToken(A);
  const { body } = await checkoutRent(token, 50000);
  assert.deepEqual(await confirm(body.reference), { state: 'pending' });
  let [rows] = await pool.query('SELECT id FROM rent_payments WHERE lease_id = :l', { l: A.leaseId });
  const before = rows.length;

  txs.get(await txOf(body.reference)).status = 'approved';
  assert.deepEqual(await confirm(body.reference), { state: 'paid' });
  assert.deepEqual(await confirm(body.reference), { state: 'paid' });
  [rows] = await pool.query('SELECT id, payment_method, online_transaction_id AS tx, amount FROM rent_payments WHERE lease_id = :l', { l: A.leaseId });
  assert.equal(rows.length, before + 1);
  const txId = await txOf(body.reference);
  const row = rows.find((r) => r.tx === `fedapay:${txId}`);
  assert.ok(row);
  assert.equal(row.payment_method, 'mobile_money');
  assert.equal(Number(row.amount), 50000);
});

test('transaction approuvée mais montant ou référence différents : rien n\'est enregistré', async () => {
  const token = await portalToken(A);
  const [[{ n: before }]] = await pool.query('SELECT COUNT(*) AS n FROM rent_payments WHERE lease_id = :l', { l: A.leaseId });

  const a = (await checkoutRent(token, 50000)).body;
  const tA = txs.get(await txOf(a.reference));
  tA.status = 'approved';
  tA.amount = 1000; // montant réellement payé ≠ montant de l'intention
  assert.deepEqual(await confirm(a.reference), { state: 'failed' });

  const b = (await checkoutRent(token, 50000)).body;
  const tB = txs.get(await txOf(b.reference));
  tB.status = 'approved';
  tB.meta = { lyko_reference: 'f'.repeat(32) }; // transaction d'une AUTRE intention
  assert.deepEqual(await confirm(b.reference), { state: 'failed' });

  const [[{ n: after }]] = await pool.query('SELECT COUNT(*) AS n FROM rent_payments WHERE lease_id = :l', { l: A.leaseId });
  assert.equal(after, before);
});

test('refusée / annulée → échec, rien d\'enregistré', async () => {
  const token = await portalToken(A);
  const { body } = await checkoutRent(token);
  txs.get(await txOf(body.reference)).status = 'declined';
  assert.deepEqual(await confirm(body.reference), { state: 'failed' });
});

test('référence inventée ou malformée : 404 (aucune énumération, aucune injection)', async () => {
  for (const ref of ['0'.repeat(32), 'abc', "' OR 1=1 --", '', null, 123, { $ne: 1 }]) {
    const res = await post('/api/online-payments/confirm', { reference: ref });
    assert.equal(res.status, 404, JSON.stringify(ref));
  }
});

test('charge : le montant est le reste dû calculé par le serveur ; facture d\'un autre bail introuvable', async () => {
  const [ch] = await pool.query(
    `INSERT INTO utility_charges (tenant_id, lease_id, utility_type, reading_start, reading_end, unit_price, amount, loss_share_amount, billed_at, period_start, period_end, recorded_by)
     VALUES (:t, :l, 'sbee', 0, 120, 100, 12000, 0, '2026-03-31', '2026-03-01', '2026-03-31', :by)`,
    { t: A.tenantId, l: A.leaseId, by: A.dgId },
  );
  const token = await portalToken(A);
  calls = [];
  const res = await post(`/api/portal/${token}/charges/${ch.insertId}/checkout`, { amount: 1 }); // le montant client est ignoré
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(calls.find((c) => c.path === '/v1/transactions').body.amount, 12000);

  const tokenB = await portalToken(B).catch(() => null);
  if (tokenB) {
    const stolen = await post(`/api/portal/${tokenB}/charges/${ch.insertId}/checkout`, {});
    assert.ok([404, 400].includes(stolen.status));
  }

  txs.get(await txOf(body.reference)).status = 'approved';
  assert.deepEqual(await confirm(body.reference), { state: 'paid' });
  const [[p]] = await pool.query('SELECT amount, payment_method FROM utility_payments WHERE charge_id = :c', { c: ch.insertId });
  assert.equal(Number(p.amount), 12000);
  assert.equal(p.payment_method, 'mobile_money');
});

function signed(secret, bodyObj, { t = Math.floor(Date.now() / 1000), key = secret } = {}) {
  const raw = JSON.stringify(bodyObj);
  const s = crypto.createHmac('sha256', key).update(`${t}.${raw}`).digest('hex');
  return { raw, header: `t=${t},s=${s}` };
}
const hook = (tenantId, raw, header) => fetch(`${baseUrl}/api/webhooks/fedapay/${tenantId}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(header ? { 'x-fedapay-signature': header } : {}) }, body: raw,
});

test('webhook : signature absente, fausse ou rejouée → ignoré ; signature valide → relit et enregistre', async () => {
  const token = await portalToken(A);
  const { body } = await checkoutRent(token, 50000);
  const id = await txOf(body.reference);
  txs.get(id).status = 'approved';
  const payload = { name: 'transaction.approved', entity: { id: Number(id) } };
  const countRows = async () => (await pool.query('SELECT id FROM rent_payments WHERE lease_id = :l AND online_transaction_id = :k', { l: A.leaseId, k: `fedapay:${id}` }))[0].length;

  // sans signature
  let raw = JSON.stringify(payload);
  assert.equal((await hook(A.tenantId, raw, null)).status, 200);
  assert.equal(await countRows(), 0);
  // mauvais secret
  let s = signed(WEBHOOK_SECRET, payload, { key: 'autre_secret' });
  await hook(A.tenantId, s.raw, s.header);
  assert.equal(await countRows(), 0);
  // horodatage trop ancien (rejeu)
  s = signed(WEBHOOK_SECRET, payload, { t: Math.floor(Date.now() / 1000) - 3600 });
  await hook(A.tenantId, s.raw, s.header);
  assert.equal(await countRows(), 0);
  // corps altéré après signature
  s = signed(WEBHOOK_SECRET, payload);
  await hook(A.tenantId, s.raw.replace(id, '1'), s.header);
  assert.equal(await countRows(), 0);
  // webhook signé avec le secret du cabinet A envoyé au cabinet B
  s = signed(WEBHOOK_SECRET, payload);
  await hook(B.tenantId, s.raw, s.header);
  assert.equal(await countRows(), 0);
  // valide
  s = signed(WEBHOOK_SECRET, payload);
  assert.equal((await hook(A.tenantId, s.raw, s.header)).status, 200);
  assert.equal(await countRows(), 1);
  // rejeu valide : pas de doublon
  s = signed(WEBHOOK_SECRET, payload);
  await hook(A.tenantId, s.raw, s.header);
  assert.equal(await countRows(), 1);
});

test('webhook avec statut approuvé annoncé mais FedaPay dit « pending » : rien (le corps du webhook n\'est jamais cru)', async () => {
  const token = await portalToken(A);
  const { body } = await checkoutRent(token, 50000);
  const id = await txOf(body.reference);
  const s = signed(WEBHOOK_SECRET, { name: 'transaction.approved', entity: { id: Number(id), status: 'approved', amount: 50000 } });
  await hook(A.tenantId, s.raw, s.header);
  const [rows] = await pool.query('SELECT id FROM rent_payments WHERE online_transaction_id = :k', { k: `fedapay:${id}` });
  assert.equal(rows.length, 0);
});

test('paramètres : les secrets FedaPay (clé, webhook) ne sont jamais renvoyés', async () => {
  const res = await fetch(`${baseUrl}/api/settings`, { headers: bearer(A.dgId, A.tenantId) });
  const text = await res.text();
  assert.ok(!text.includes('sk_sandbox_COLLECT_SECRET'));
  assert.ok(!text.includes(WEBHOOK_SECRET));
  const s = JSON.parse(text).settings;
  assert.equal(s.fedapayCollectEnabled, true);
  assert.equal(s.fedapayWebhookConfigured, true);
});

test('activer le paiement en ligne sans clé enregistrée est refusé', async () => {
  const C = await createBareFixture();
  const res = await fetch(`${baseUrl}/api/settings`, {
    method: 'PATCH', headers: { Authorization: bearer(C.dgId, C.tenantId).Authorization },
    body: (() => { const fd = new FormData(); fd.append('fedapayCollectEnabled', 'true'); return fd; })(),
  });
  assert.equal(res.status, 400);
  await teardown(C.tenantId);
});

test('paiement en ligne confirmé : visible sur le portail du locataire, avec quittance téléchargeable', async () => {
  const token = await portalToken(A);
  const { body } = await checkoutRent(token, 50000);
  txs.get(await txOf(body.reference)).status = 'approved';
  assert.deepEqual(await confirm(body.reference), { state: 'paid' });
  const dash = await (await fetch(`${baseUrl}/api/portal/${token}`)).json();
  const txId = await txOf(body.reference);
  const [[row]] = await pool.query('SELECT id FROM rent_payments WHERE online_transaction_id = :k', { k: `fedapay:${txId}` });
  const p = dash.payments.find((x) => x.id === row.id);
  assert.ok(p, 'le paiement figure dans la liste du locataire');
  assert.ok(p.receipt, 'une quittance existe');
  const pdf = await fetch(`${baseUrl}/api/portal/${token}/payments/${row.id}/receipt.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
});

test('paiement en ligne : visible aussi sur la fiche du locataire côté entreprise, avec sa quittance', async () => {
  const token = await portalToken(A);
  const { body } = await checkoutRent(token, 50000);
  txs.get(await txOf(body.reference)).status = 'approved';
  assert.deepEqual(await confirm(body.reference), { state: 'paid' });
  const txId = await txOf(body.reference);
  const [[row]] = await pool.query('SELECT id FROM rent_payments WHERE online_transaction_id = :k', { k: `fedapay:${txId}` });
  const res = await fetch(`${baseUrl}/api/renters/${A.renterId}`, { headers: bearer(A.dgId, A.tenantId) });
  assert.equal(res.status, 200);
  const text = JSON.stringify(await res.json());
  const detail = JSON.parse(text);
  const all = JSON.stringify(detail);
  assert.ok(all.includes(`"id":${row.id},`), 'le paiement en ligne figure sur la fiche');
  assert.ok(all.includes('Paiement en ligne'));
});
