'use strict';
process.env.SUBSCRIPTIONS_ENFORCED = 'true';

/** Back-office et remboursement sous garantie de 15 jours (FedaPay simulé). */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const config = require('../src/config/env');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken, signAdminToken } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');

const realFetch = global.fetch;
const txs = new Map();
const payouts = new Map();
let nextId = 7000;
let payoutOutcome = 'sent';
let fx; let server; let base; let adminId; let adminToken;
const sentEmails = [];

function mock() {
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('fedapay.com') || u.includes('process.fedapay.com')) return realFetch(url, init);
    const path = new URL(u).pathname;
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    const body = init.body ? JSON.parse(init.body) : null;
    if (init.method === 'POST' && path === '/v1/transactions') {
      const id = nextId++;
      txs.set(String(id), { status: 'pending', amount: body.amount, meta: body.custom_metadata });
      return json({ 'v1/transaction': { id, status: 'pending', amount: body.amount, custom_metadata: body.custom_metadata } });
    }
    let m = path.match(/^\/v1\/transactions\/(\d+)\/token$/);
    if (init.method === 'POST' && m) return json({ token: 't', url: 'https://sandbox-process.fedapay.com/x' });
    m = path.match(/^\/v1\/transactions\/(\d+)$/);
    if (init.method === 'GET' && m) { const t = txs.get(m[1]); return json({ 'v1/transaction': { id: Number(m[1]), status: t.status, amount: t.amount, custom_metadata: t.meta } }); }
    if (init.method === 'POST' && path === '/v1/payouts') {
      const id = nextId++;
      payouts.set(String(id), { status: 'pending', amount: body.amount, body });
      return json({ 'v1/payout': { id, status: 'pending' } });
    }
    if (init.method === 'PUT' && path === '/v1/payouts/start') { payouts.get(String(body.payouts[0].id)).status = payoutOutcome; return json({ 'v1/payouts': [{ id: body.payouts[0].id, status: 'started' }] }); }
    m = path.match(/^\/v1\/payouts\/(\d+)$/);
    if (init.method === 'GET' && m) { const p = payouts.get(m[1]); return json({ 'v1/payout': { id: Number(m[1]), status: p.status, amount: p.amount } }); }
    return json({ message: 'inconnu' }, 404);
  };
}

const dgHdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}`, 'Content-Type': 'application/json' });
const adHdr = () => ({ Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' });
const call = (method, path, body, headers) => realFetch(base + path, { method, headers: headers ?? { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const sub = async () => (await pool.query('SELECT * FROM tenant_subscriptions WHERE tenant_id = :t', { t: fx.tenantId }))[0][0];

async function buyAndPay() {
  const r = await (await call('POST', '/api/billing/checkout', { planKey: 'pro', months: 4 }, dgHdr())).json();
  const id = (await pool.query('SELECT fedapay_transaction_id id FROM subscription_payments WHERE reference = :r', { r: r.reference }))[0][0].id;
  txs.get(id).status = 'approved';
  await call('POST', '/api/billing/confirm', { reference: r.reference });
}

before(async () => {
  mock();
  config.platform.fedapaySecretKey = 'sk_platform_SECRET';
  config.platform.fedapayWebhookSecret = 'wh';
  fx = await createBareFixture();
  await pool.query("INSERT INTO tenant_subscriptions (tenant_id, plan_key, status) VALUES (:t, NULL, 'pending_payment') ON DUPLICATE KEY UPDATE plan_key = NULL, status = 'pending_payment'", { t: fx.tenantId });
  await pool.query('UPDATE users SET email = :e, first_name = :n WHERE id = :id', { e: 'dg-refund@example.com', n: 'Awa', id: fx.dgId });
  const [a] = await pool.query("INSERT INTO platform_admins (email, name, password_hash) VALUES (:e, 'Admin Test', :h)", { e: `admin-${Date.now()}@aim.test`, h: await hashPassword('motdepasse-solide-1') });
  adminId = a.insertId;
  adminToken = signAdminToken({ sub: adminId });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  global.fetch = realFetch;
  server.close();
  await pool.query('DELETE FROM subscription_refunds WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM subscription_payments WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM platform_admins WHERE id = :id', { id: adminId });
  await teardown(fx.tenantId);
  await closePool();
});

test('sécurité : un jeton employé n’ouvre pas le back-office, un jeton admin n’ouvre pas l’espace client', async () => {
  assert.equal((await call('GET', '/api/admin/me', null, dgHdr())).status, 401);
  assert.equal((await call('GET', '/api/admin/me')).status, 401);
  assert.equal((await call('GET', '/api/admin/me', null, adHdr())).status, 200);
  assert.equal((await call('GET', '/api/billing/subscription', null, adHdr())).status, 401);
});

test('connexion admin : mauvais mot de passe refusé, bon accepté', async () => {
  const [[row]] = await pool.query('SELECT email FROM platform_admins WHERE id = :id', { id: adminId });
  assert.equal((await call('POST', '/api/admin/login', { email: row.email, password: 'faux' })).status, 401);
  const ok = await call('POST', '/api/admin/login', { email: row.email, password: 'motdepasse-solide-1' });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).token);
});

test('sans paiement : pas de remboursement possible', async () => {
  const r = await call('POST', '/api/billing/refund-requests', { reason: 'Je ne suis pas satisfait du tout' }, dgHdr());
  assert.equal(r.status, 400);
});

let refundId; let token;
test('demande dans les 15 jours : créée une seule fois, raison obligatoire', async () => {
  await buyAndPay();
  assert.equal((await call('POST', '/api/billing/refund-requests', { reason: 'court' }, dgHdr())).status, 400);
  const r = await call('POST', '/api/billing/refund-requests', { reason: 'Les fonctions ne correspondent pas à mon besoin' }, dgHdr());
  assert.equal(r.status, 201);
  refundId = (await r.json()).id;
  assert.equal((await call('POST', '/api/billing/refund-requests', { reason: 'Seconde demande identique ici' }, dgHdr())).status, 409);
  const list = await (await call('GET', '/api/admin/refunds?status=requested', null, adHdr())).json();
  assert.ok(list.refunds.some((x) => x.id === refundId));
});

test('délai dépassé : demande refusée (autre entreprise simulée)', async () => {
  await pool.query('UPDATE tenant_subscriptions SET refund_eligible_until = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM subscription_refunds WHERE id = :id', { id: refundId });
  const r = await call('POST', '/api/billing/refund-requests', { reason: 'Demande hors délai de quinze jours' }, dgHdr());
  assert.equal(r.status, 400);
  await pool.query('UPDATE tenant_subscriptions SET refund_eligible_until = DATE_ADD(NOW(), INTERVAL 10 DAY) WHERE tenant_id = :t', { t: fx.tenantId });
  refundId = (await (await call('POST', '/api/billing/refund-requests', { reason: 'Les fonctions ne correspondent pas à mon besoin' }, dgHdr())).json()).id;
});

test('validation admin : frais retenus, montant remboursé = payé − frais, lien à usage unique', async () => {
  const bad = await call('POST', `/api/admin/refunds/${refundId}/approve`, { feeAmount: 999999 }, adHdr());
  assert.equal(bad.status, 400);
  const ok = await (await call('POST', `/api/admin/refunds/${refundId}/approve`, { feeAmount: 1500, note: 'ok' }, adHdr())).json();
  assert.equal(ok.refundAmount, 49000 - 1500);
  assert.equal((await call('POST', `/api/admin/refunds/${refundId}/approve`, {}, adHdr())).status, 409); // déjà traitée
  // le jeton n'est stocké que haché : on en pose un connu pour la suite
  token = 'a'.repeat(64);
  await pool.query("UPDATE subscription_refunds SET token_hash = SHA2(:t, 256) WHERE id = :id", { t: token, id: refundId });
});

test('lien client : infos puis coordonnées ; numéro invalide refusé ; second usage refusé', async () => {
  const info = await (await call('GET', `/api/billing/refund-link/${token}`)).json();
  assert.equal(info.refundAmount, 47500);
  assert.equal((await call('GET', `/api/billing/refund-link/${'b'.repeat(64)}`)).status, 404);
  assert.equal((await call('POST', `/api/billing/refund-link/${token}`, { name: 'Awa Dossou', phone: '12', operator: 'mtn' })).status, 400);
  assert.equal((await call('POST', `/api/billing/refund-link/${token}`, { name: 'Awa Dossou', phone: '0197000000', operator: 'mtn' })).status, 200);
  assert.equal((await call('POST', `/api/billing/refund-link/${token}`, { name: 'Autre', phone: '0197000001', operator: 'mtn' })).status, 404);
  assert.equal((await call('GET', `/api/billing/refund-link/${token}`)).status, 404);
});

test('virement en échec : relançable, rien n’est clôturé', async () => {
  payoutOutcome = 'failed';
  const r = await (await call('POST', `/api/admin/refunds/${refundId}/pay`, null, adHdr())).json();
  assert.equal(r.status, 'failed');
  assert.equal((await sub()).status, 'active');
});

test('virement réussi : montant exact, abonnement clôturé et coupé, paiement marqué remboursé', async () => {
  payoutOutcome = 'sent';
  const r = await (await call('POST', `/api/admin/refunds/${refundId}/pay`, null, adHdr())).json();
  assert.equal(r.status, 'paid');
  const last = [...payouts.values()].pop();
  assert.equal(last.amount, 47500);
  assert.equal(last.body.mode, 'mtn_open');
  assert.equal((await sub()).status, 'refunded');
  assert.equal((await pool.query('SELECT status FROM subscription_payments WHERE tenant_id = :t', { t: fx.tenantId }))[0][0].status, 'refunded');
  assert.equal((await call('GET', '/api/payslips', null, dgHdr())).status, 402);
  // second paiement impossible
  assert.equal((await call('POST', `/api/admin/refunds/${refundId}/pay`, null, adHdr())).status, 409);
  // il peut racheter un abonnement (prix normal, sans nouvelle garantie)
  const again = await (await call('POST', '/api/billing/checkout', { planKey: 'pro', months: 4 }, dgHdr())).json();
  assert.equal(again.amount, 65000);
});

test('refus : motif obligatoire', async () => {
  const [ins] = await pool.query("INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, amount, status, is_first_purchase) VALUES (:t, :r, 'pro', 4, 49000, 'paid', 0)", { t: fx.tenantId, r: 'c'.repeat(32) });
  const [rf] = await pool.query("INSERT INTO subscription_refunds (tenant_id, payment_id, reason, amount_paid) VALUES (:t, :p, 'Une raison quelconque', 49000)", { t: fx.tenantId, p: ins.insertId });
  assert.equal((await call('POST', `/api/admin/refunds/${rf.insertId}/reject`, { note: '' }, adHdr())).status, 400);
  assert.equal((await call('POST', `/api/admin/refunds/${rf.insertId}/reject`, { note: 'Raison non recevable' }, adHdr())).status, 200);
  assert.equal((await pool.query('SELECT status FROM subscription_refunds WHERE id = :id', { id: rf.insertId }))[0][0].status, 'rejected');
});

test('attribution manuelle par l’admin', async () => {
  const r = await call('POST', `/api/admin/tenants/${fx.tenantId}/grant`, { planKey: 'demarrage', months: 2, note: 'Geste commercial' }, adHdr());
  assert.equal(r.status, 200);
  const s = await sub();
  assert.equal(s.plan_key, 'demarrage');
  assert.equal(s.status, 'active');
});

test('entreprise interne : l’admin peut la passer en offre payante, puis la remettre en interne', async () => {
  await pool.query("UPDATE tenant_subscriptions SET plan_key = 'interne', status = 'active', current_period_end = NULL WHERE tenant_id = :t", { t: fx.tenantId });
  assert.equal((await call('POST', `/api/admin/tenants/${fx.tenantId}/grant`, { planKey: 'pro', months: 4, note: 'Passage en client payant' }, adHdr())).status, 200);
  let s = await sub();
  assert.equal(s.plan_key, 'pro');
  assert.ok(s.current_period_end);
  assert.equal((await call('POST', `/api/admin/tenants/${fx.tenantId}/internal`, { note: '' }, adHdr())).status, 400);
  assert.equal((await call('POST', `/api/admin/tenants/${fx.tenantId}/internal`, { note: 'Compte de démonstration' }, adHdr())).status, 200);
  s = await sub();
  assert.equal(s.plan_key, 'interne');
  assert.equal(s.current_period_end, null);
  assert.equal((await call('POST', `/api/admin/tenants/${fx.tenantId}/internal`, { note: 'x' }, dgHdr())).status, 401);
});
