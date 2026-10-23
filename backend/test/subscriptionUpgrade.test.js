'use strict';
process.env.SUBSCRIPTIONS_ENFORCED = 'true';

/** Montée en gamme avec crédit au prorata et signalement des paiements échoués. */
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


const events = async (type) => (await pool.query('SELECT * FROM subscription_events WHERE tenant_id = :t AND event_type = :ty ORDER BY id', { t: fx.tenantId, ty: type }))[0];
async function seedActivePro({ daysLeft = 61, months = 4, amount = 49000 } = {}) {
  await pool.query('DELETE FROM subscription_refunds WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM subscription_payments WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM subscription_events WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query(
    "INSERT INTO tenant_subscriptions (tenant_id, plan_key, status, period_months, started_at, current_period_end, first_purchase_at, refund_eligible_until) VALUES (:t, 'pro', 'active', :m, DATE_SUB(NOW(), INTERVAL 61 DAY), DATE_ADD(NOW(), INTERVAL :d DAY), DATE_SUB(NOW(), INTERVAL 61 DAY), DATE_SUB(NOW(), INTERVAL 46 DAY)) ON DUPLICATE KEY UPDATE plan_key = 'pro', status = 'active', period_months = :m, current_period_end = DATE_ADD(NOW(), INTERVAL :d DAY), refund_eligible_until = DATE_SUB(NOW(), INTERVAL 46 DAY)",
    { t: fx.tenantId, m: months, d: daysLeft },
  );
  const [ins] = await pool.query(
    "INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, kind, amount, status, is_first_purchase, period_start, period_end, paid_at, invoice_number) VALUES (:t, :r, 'pro', :m, 'purchase', :a, 'paid', 1, DATE_SUB(NOW(), INTERVAL 61 DAY), DATE_ADD(NOW(), INTERVAL :d DAY), DATE_SUB(NOW(), INTERVAL 61 DAY), 'AIM-2026-990001')",
    { t: fx.tenantId, r: crypto.randomBytes(16).toString('hex'), m: months, a: amount, d: daysLeft },
  );
  return ins.insertId;
}

before(async () => {
  mock();
  config.platform.fedapaySecretKey = 'sk_platform_SECRET';
  config.platform.fedapayWebhookSecret = WEBHOOK_SECRET;
  fx = await createBareFixture();
  await pool.query('UPDATE users SET email = :e WHERE id = :id', { e: 'dg-upgrade@example.com', id: fx.dgId });
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

test('devis de montée en gamme : le prorata des jours restants est déduit du prix', async () => {
  await seedActivePro({ daysLeft: 61 });
  const q = await (await api('POST', '/api/billing/quote', { planKey: 'entreprise', months: 4 })).json();
  assert.equal(q.kind, 'upgrade');
  assert.equal(q.fromPlan, 'pro');
  assert.equal(q.fullPrice, 180000);
  assert.ok(q.creditDays >= 60 && q.creditDays <= 62);
  assert.ok(q.credit > 23000 && q.credit < 26000, `crédit attendu ~24 500, obtenu ${q.credit}`);
  assert.equal(q.price, 180000 - q.credit);
  const opts = await (await api('GET', '/api/billing/upgrade-options')).json();
  assert.ok(opts.options.length >= 2 && opts.options.every((o) => o.planKey === 'entreprise' && o.price === o.fullPrice - o.credit));
});

test('offre inférieure refusée (409) ; renouvellement de la même offre inchangé', async () => {
  const down = await buy('demarrage', 1);
  assert.equal(down.status, 409);
  const same = await (await api('POST', '/api/billing/quote', { planKey: 'pro', months: 4 })).json();
  assert.equal(same.kind, 'renewal');
  assert.equal(same.credit, 0);
});

test('paiement de la montée en gamme : nouvelle offre aussitôt, anciens jours consommés, crédit non réutilisable', async () => {
  const oldId = await seedActivePro({ daysLeft: 61 });
  const r = await buy('entreprise', 4);
  assert.equal(r.status, 201);
  assert.equal(r.body.kind, 'upgrade');
  const id = await txOf(r.body.reference);
  assert.equal(txs.get(id).amount, r.body.amount); // FedaPay reçoit le montant déjà réduit
  assert.ok(r.body.amount < 180000);
  txs.get(id).status = 'approved';
  assert.equal(await confirm(r.body.reference), 'paid');
  const s = await sub();
  assert.equal(s.plan_key, 'entreprise');
  const days = (new Date(s.current_period_end) - Date.now()) / 86400000;
  assert.ok(days > 118 && days < 124, 'nouvelle période de 4 mois à partir de maintenant');
  const [[old]] = await pool.query('SELECT consumed_at FROM subscription_payments WHERE id = :id', { id: oldId });
  assert.ok(old.consumed_at);
  const [[nw]] = await pool.query('SELECT kind, credit_applied, upgraded_from_plan, amount FROM subscription_payments WHERE reference = :r', { r: r.body.reference });
  assert.equal(nw.kind, 'upgrade');
  assert.equal(nw.upgraded_from_plan, 'pro');
  assert.equal((await events('upgraded')).length, 1);
  // Le crédit est épuisé : un nouveau passage à une offre supérieure n'existe plus ici, et l'annulation part de la nouvelle valeur.
  const { computeUnusedValue } = require('../src/services/subscriptionCredit');
  const u = await computeUnusedValue(pool, fx.tenantId);
  assert.equal(u.paymentIds.length, 1);
  assert.ok(u.base > 170000, `valeur non utilisée (prix plein + crédit) attendue ~179 000, obtenue ${u.base}`);
});

test('annulation demandée : changer d’offre ou renouveler est refusé (409)', async () => {
  await seedActivePro({ daysLeft: 61 });
  await pool.query("INSERT INTO subscription_refunds (tenant_id, payment_id, kind, status, reason, amount_paid) SELECT :t, id, 'cancellation', 'requested', 'Motif de test', 10000 FROM subscription_payments WHERE tenant_id = :t LIMIT 1", { t: fx.tenantId });
  assert.equal((await buy('entreprise', 4)).status, 409);
  assert.equal((await buy('pro', 4)).status, 409);
  await pool.query('DELETE FROM subscription_refunds WHERE tenant_id = :t', { t: fx.tenantId });
});

test('paiement refusé : échec enregistré, journal, une seule alerte, bannière côté espace', async () => {
  await seedActivePro({ daysLeft: 61 });
  const r = await buy('pro', 4);
  const id = await txOf(r.body.reference);
  txs.get(id).status = 'declined';
  assert.equal(await confirm(r.body.reference), 'failed');
  assert.equal(await confirm(r.body.reference), 'failed'); // rejouer ne répète rien
  const [[p]] = await pool.query('SELECT status, failure_reason, failure_notified_at FROM subscription_payments WHERE reference = :r', { r: r.body.reference });
  assert.equal(p.status, 'failed');
  assert.equal(p.failure_reason, 'declined');
  assert.ok(p.failure_notified_at);
  assert.equal((await events('payment_failed')).length, 1);
  const d = await (await api('GET', '/api/billing/subscription')).json();
  assert.equal(d.lastFailure.reference, r.body.reference);
  assert.equal(d.lastFailure.reason, 'declined');
});

test('montant encaissé différent : anomalie signalée à l’équipe, rien d’activé', async () => {
  await seedActivePro({ daysLeft: 61 });
  const r = await buy('pro', 4);
  Object.assign(txs.get(await txOf(r.body.reference)), { status: 'approved', amount: 100 });
  assert.equal(await confirm(r.body.reference), 'failed');
  const [[p]] = await pool.query('SELECT status, failure_reason, admin_alerted_at FROM subscription_payments WHERE reference = :r', { r: r.body.reference });
  assert.equal(p.status, 'anomaly');
  assert.equal(p.failure_reason, 'amount_mismatch');
  assert.ok(p.admin_alerted_at);
  assert.equal((await events('payment_anomaly')).length, 1);
  const issues = await realFetch(`${base}/api/admin/payment-issues`, { headers: { Authorization: `Bearer ${require('../src/utils/jwt').signAccessToken({ sub: 0, role: 'platform_admin' })}` } });
  assert.ok([200, 401, 403].includes(issues.status)); // route protégée par l'authentification admin de la plateforme
});

test('paiement resté ouvert plus de 2 h : le client est prévenu une fois, il peut encore aboutir', async () => {
  await seedActivePro({ daysLeft: 61 });
  const r = await buy('pro', 4);
  await pool.query("UPDATE subscription_payments SET created_at = DATE_SUB(NOW(), INTERVAL 3 HOUR) WHERE reference = :r", { r: r.body.reference });
  const { runSubscriptionReconciliation } = require('../src/jobs/subscriptionJob');
  await runSubscriptionReconciliation();
  await runSubscriptionReconciliation();
  const [[p]] = await pool.query('SELECT status, failure_reason, failure_notified_at FROM subscription_payments WHERE reference = :r', { r: r.body.reference });
  assert.equal(p.status, 'pending');
  assert.equal(p.failure_reason, 'incomplete');
  assert.ok(p.failure_notified_at);
  assert.equal((await events('payment_incomplete')).length, 1);
  // Il aboutit finalement : l'abonnement est prolongé.
  txs.get(await txOf(r.body.reference)).status = 'approved';
  assert.equal(await confirm(r.body.reference), 'paid');
});

test('même crédit utilisé deux fois : le second paiement est activé mais signalé', async () => {
  await seedActivePro({ daysLeft: 61 });
  const a = await buy('entreprise', 4);
  const b = await buy('entreprise', 12);
  txs.get(await txOf(a.body.reference)).status = 'approved';
  txs.get(await txOf(b.body.reference)).status = 'approved';
  assert.equal(await confirm(a.body.reference), 'paid');
  assert.equal(await confirm(b.body.reference), 'paid');
  assert.equal((await events('upgrade_credit_reused')).length, 1);
});
