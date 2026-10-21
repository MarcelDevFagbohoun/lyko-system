'use strict';
process.env.SUBSCRIPTIONS_ENFORCED = 'true';

/** Facturation des abonnements via le compte FedaPay de la plateforme (FedaPay simulé via `fetch`). */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { pool, closePool } = require('../src/config/db');
const config = require('../src/config/env');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { FOUNDER_OFFER } = require('../src/constants/plans');
const { runSubscriptionJob } = require('../src/jobs/subscriptionJob');

const WEBHOOK_SECRET = 'whsec_platform_test';
const realFetch = global.fetch;
const txs = new Map();
let nextTx = 9000;
let fx; let server; let base;

function mock() {
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('fedapay.com') || u.includes('process.fedapay.com')) return realFetch(url, init);
    const path = new URL(u).pathname;
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    const body = init.body ? JSON.parse(init.body) : null;
    assert.equal(init.headers.Authorization, 'Bearer sk_platform_SECRET'); // bien le compte de la plateforme
    if (init.method === 'POST' && path === '/v1/transactions') {
      const id = nextTx++;
      txs.set(String(id), { status: 'pending', amount: body.amount, meta: body.custom_metadata });
      return json({ 'v1/transaction': { id, status: 'pending', amount: body.amount, custom_metadata: body.custom_metadata } });
    }
    let m = path.match(/^\/v1\/transactions\/(\d+)\/token$/);
    if (init.method === 'POST' && m) return json({ token: 'tok', url: 'https://sandbox-process.fedapay.com/abc' });
    m = path.match(/^\/v1\/transactions\/(\d+)$/);
    if (init.method === 'GET' && m) {
      const t = txs.get(m[1]);
      return json({ 'v1/transaction': { id: Number(m[1]), status: t.status, amount: t.amount, custom_metadata: t.meta } });
    }
    return json({ message: 'inconnu' }, 404);
  };
}

const hdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}`, 'Content-Type': 'application/json' });
const api = (method, path, body, auth = true) =>
  realFetch(base + path, { method, headers: auth ? hdr() : { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const sub = async () => (await pool.query('SELECT *, (current_period_end > NOW()) running FROM tenant_subscriptions WHERE tenant_id = :t', { t: fx.tenantId }))[0][0];
async function buy(planKey, months, extra = {}) {
  const r = await api('POST', '/api/billing/checkout', { planKey, months, ...extra });
  const body = await r.json();
  return { status: r.status, body };
}
const txOf = async (ref) => (await pool.query('SELECT fedapay_transaction_id id FROM subscription_payments WHERE reference = :r', { r: ref }))[0][0].id;
const confirm = async (reference) => (await (await api('POST', '/api/billing/confirm', { reference }, false)).json()).state;

before(async () => {
  mock();
  config.platform.fedapaySecretKey = 'sk_platform_SECRET';
  config.platform.fedapayWebhookSecret = WEBHOOK_SECRET;
  fx = await createBareFixture();
  await pool.query("INSERT INTO tenant_subscriptions (tenant_id, plan_key, status) VALUES (:t, NULL, 'pending_payment') ON DUPLICATE KEY UPDATE plan_key = NULL, status = 'pending_payment'", { t: fx.tenantId });
  await pool.query('UPDATE users SET email = :e WHERE id = :id', { e: 'dg-test@example.com', id: fx.dgId });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  global.fetch = realFetch;
  server.close();
  await pool.query('DELETE FROM subscription_payments WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

test('catalogue public : offres, places fondateur, garantie', async () => {
  const body = await (await api('GET', '/api/billing/plans', null, false)).json();
  assert.deepEqual(body.plans.map((p) => p.key), ['demarrage', 'pro', 'entreprise']);
  assert.equal(body.founder.price, FOUNDER_OFFER.price);
  assert.ok(body.founder.remaining <= FOUNDER_OFFER.maxCompanies);
  assert.equal(body.refundWindowDays, 15);
});

test('le client ne choisit jamais le prix : montant imposé par le serveur, offre inconnue refusée', async () => {
  const bad = await buy('pro', 3);
  assert.equal(bad.status, 400);
  const r = await buy('pro', 4, { amount: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.body.amount, FOUNDER_OFFER.price); // 1re achat Pro 4 mois = tarif fondateur
  assert.equal(r.body.founder, true);
  const id = await txOf(r.body.reference);
  assert.equal(txs.get(id).amount, 49000);
  // en attente tant que FedaPay n'a pas approuvé : rien n'est activé
  assert.equal(await confirm(r.body.reference), 'pending');
  assert.equal((await sub()).status, 'pending_payment');
  globalThis.__ref1 = r.body.reference;
});

test('paiement approuvé : abonnement actif 4 mois, garantie 15 jours, facture ; confirmation idempotente', async () => {
  const ref = globalThis.__ref1;
  txs.get(await txOf(ref)).status = 'approved';
  assert.equal(await confirm(ref), 'paid');
  const s1 = await sub();
  assert.equal(s1.status, 'active');
  assert.equal(s1.plan_key, 'pro');
  assert.equal(s1.founder_price, 1);
  assert.ok(s1.refund_eligible_until);
  const end1 = new Date(s1.current_period_end).getTime();
  assert.equal(await confirm(ref), 'paid'); // 2e confirmation : aucune prolongation
  assert.equal(new Date((await sub()).current_period_end).getTime(), end1);
  const pays = await (await api('GET', '/api/billing/payments')).json();
  assert.equal(pays.payments.length, 1);
  assert.match(pays.payments[0].invoiceNumber, /^LYKO-\d{4}-\d{6}$/);
  const pdf = await api('GET', `/api/billing/payments/${pays.payments[0].id}/invoice.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const d = await (await api('GET', '/api/billing/subscription')).json();
  assert.equal(d.active, true);
  assert.equal(d.refundOpen, true);
});

test('renouvellement : prix normal (plus de tarif fondateur), prolonge depuis l’échéance', async () => {
  const before = new Date((await sub()).current_period_end).getTime();
  const r = await buy('pro', 4);
  assert.equal(r.body.amount, 65000);
  assert.equal(r.body.founder, false);
  txs.get(await txOf(r.body.reference)).status = 'approved';
  assert.equal(await confirm(r.body.reference), 'paid');
  const after = new Date((await sub()).current_period_end).getTime();
  assert.ok(after - before > 119 * 86400000 && after - before < 124 * 86400000, 'environ +4 mois');
});

test('webhook : signature fausse ignorée ; signature valide active', async () => {
  const r = await buy('pro', 12);
  const id = await txOf(r.body.reference);
  txs.get(id).status = 'approved';
  const payload = JSON.stringify({ name: 'transaction.approved', entity: { id: Number(id) } });
  const sign = (key) => { const t = Math.floor(Date.now() / 1000); return `t=${t},s=${crypto.createHmac('sha256', key).update(`${t}.${payload}`).digest('hex')}`; };
  const post = (sig) => realFetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fedapay-signature': sig }, body: payload });
  assert.equal((await post(sign('mauvais'))).status, 200);
  assert.equal((await pool.query('SELECT status FROM subscription_payments WHERE reference = :r', { r: r.body.reference }))[0][0].status, 'pending');
  assert.equal((await post(sign(WEBHOOK_SECRET))).status, 200);
  assert.equal((await pool.query('SELECT status FROM subscription_payments WHERE reference = :r', { r: r.body.reference }))[0][0].status, 'paid');
});

test('montant FedaPay différent du montant attendu : refusé, rien activé', async () => {
  const r = await buy('entreprise', 4);
  const id = await txOf(r.body.reference);
  Object.assign(txs.get(id), { status: 'approved', amount: 100 });
  const before = (await sub()).plan_key;
  assert.equal(await confirm(r.body.reference), 'failed');
  assert.equal((await sub()).plan_key, before);
});

test('paiement refusé par FedaPay : échec', async () => {
  const r = await buy('demarrage', 2);
  txs.get(await txOf(r.body.reference)).status = 'declined';
  assert.equal(await confirm(r.body.reference), 'failed');
});

test('référence inconnue ou mal formée : échec sans erreur', async () => {
  assert.equal(await confirm('zzz'), 'failed');
  assert.equal(await confirm('a'.repeat(32)), 'failed');
});

test('entreprise « interne » : pas d’abonnement à payer', async () => {
  await pool.query("UPDATE tenant_subscriptions SET plan_key = 'interne', status = 'active' WHERE tenant_id = :t", { t: fx.tenantId });
  assert.equal((await buy('pro', 4)).status, 400);
});

test('expiration : le job marque « expired » ; la page d’abonnement reste accessible', async () => {
  await pool.query("UPDATE tenant_subscriptions SET plan_key = 'pro', status = 'active', current_period_end = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE tenant_id = :t", { t: fx.tenantId });
  assert.equal((await api('GET', '/api/payslips')).status, 402); // coupé aussitôt
  await runSubscriptionJob();
  assert.equal((await sub()).status, 'expired');
  const d = await (await api('GET', '/api/billing/subscription')).json();
  assert.equal(d.active, false);
  assert.equal(d.status, 'expired');
  assert.equal((await buy('pro', 4)).status, 201); // peut renouveler
});
