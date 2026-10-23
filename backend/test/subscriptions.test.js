'use strict';
process.env.SUBSCRIPTIONS_ENFORCED = 'true';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { pool, closePool } = require('../src/config/db');
const config = require('../src/config/env');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { PLANS } = require('../src/constants/plans');
const { getEntitlements, assertFeature, assertWithinLimit } = require('../src/services/entitlements');

let fx; let server; let base;
const setSub = (plan, status = 'active', endSql = 'DATE_ADD(NOW(), INTERVAL 30 DAY)') =>
  pool.query(
    `INSERT INTO tenant_subscriptions (tenant_id, plan_key, status, current_period_end) VALUES (:t, :p, :s, ${endSql})
     ON DUPLICATE KEY UPDATE plan_key = VALUES(plan_key), status = VALUES(status), current_period_end = VALUES(current_period_end)`,
    { t: fx.tenantId, p: plan, s: status },
  );
const hdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}`, 'Content-Type': 'application/json' });
const call = (method, path, body) =>
  new Promise((resolve, reject) => {
    const req = http.request(base + path, { method, headers: hdr() }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
    });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });

before(async () => {
  fx = await createBareFixture();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await teardown(fx.tenantId);
  await closePool();
});

test('catalogue : prix fixés par la direction', () => {
  assert.deepEqual(PLANS.demarrage.offers, [{ months: 1, price: 15000 }, { months: 2, price: 25000 }]);
  assert.equal(PLANS.pro.offers[0].price, 65000);
  assert.equal(PLANS.pro.offers[0].months, 4);
  assert.equal(PLANS.demarrage.limits.units, 50);
  assert.equal(PLANS.demarrage.limits.owners, 10);
  assert.ok(!PLANS.demarrage.features.includes('advanced_accounting'));
  assert.ok(!PLANS.demarrage.features.includes('ai_assistant'));
});

test('inscription : sans application des abonnements => offre interne ; avec => en attente de paiement', async () => {
  const { createInitialSubscription } = require('../src/services/entitlements');
  const conn = await pool.getConnection();
  try {
    for (const [enforced, plan, status] of [[false, 'interne', 'active'], [true, null, 'pending_payment']]) {
      config.features.subscriptionsEnforced = enforced;
      await conn.query('DELETE FROM tenant_subscriptions WHERE tenant_id = :t', { t: fx.tenantId });
      await createInitialSubscription(conn, fx.tenantId);
      const [[r]] = await conn.query('SELECT plan_key, status FROM tenant_subscriptions WHERE tenant_id = :t', { t: fx.tenantId });
      assert.equal(r.plan_key, plan);
      assert.equal(r.status, status);
    }
  } finally { config.features.subscriptionsEnforced = true; conn.release(); }
});

test('sans abonnement (pending_payment) : accès refusé', async () => {
  await setSub(null, 'pending_payment', 'NULL');
  const ent = await getEntitlements(fx.tenantId);
  assert.equal(ent.active, false);
  await assert.rejects(() => assertFeature(fx.tenantId, 'core'), (e) => e.status === 402);
});

test('Démarrage : fonctions Pro refusées, limite utilisateurs appliquée', async () => {
  await setSub('demarrage');
  await assertFeature(fx.tenantId, 'tenant_collect');
  await assert.rejects(() => assertFeature(fx.tenantId, 'payroll'), (e) => e.status === 403 && e.details.code === 'FEATURE_NOT_IN_PLAN');
  const r1 = await call('GET', '/api/payslips');
  assert.equal(r1.status, 403);
  const r2 = await call('GET', '/api/gl/accounts');
  assert.equal(r2.status, 403);

  // 1 utilisateur (le DG) : un 2e passe, un 3e dépasse la limite de 2.
  const add = async () => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await assertWithinLimit(fx.tenantId, 'users', c);
      await c.query("INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t,'agent','A','B',:p,'x')", { t: fx.tenantId, p: `09${Math.floor(Math.random() * 1e8)}` });
      await c.commit();
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
  };
  await add();
  await assert.rejects(add, (e) => e.status === 403 && e.details.code === 'PLAN_LIMIT_REACHED');
});

test('limite : créations concurrentes sérialisées (jamais au-dessus du plafond)', async () => {
  await setSub('demarrage');
  await pool.query("DELETE FROM users WHERE tenant_id = :t AND role <> 'dg'", { t: fx.tenantId });
  const add = async (i) => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await assertWithinLimit(fx.tenantId, 'users', c);
      await c.query("INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t,'agent','C','D',:p,'x')", { t: fx.tenantId, p: `08${i}${Math.floor(Math.random() * 1e7)}` });
      await c.commit(); return 'ok';
    } catch (e) { await c.rollback(); return e.status; } finally { c.release(); }
  };
  const res = await Promise.all([1, 2, 3, 4, 5].map(add));
  assert.equal(res.filter((x) => x === 'ok').length, 1);
  const [[n]] = await pool.query("SELECT COUNT(*) n FROM users WHERE tenant_id=:t AND status='active'", { t: fx.tenantId });
  assert.equal(n.n, 2);
});

test('Pro : fonctions ouvertes ; comptabilité avancée réservée à Entreprise', async () => {
  await setSub('pro');
  await assertFeature(fx.tenantId, 'payroll');
  await assert.rejects(() => assertFeature(fx.tenantId, 'advanced_accounting'), (e) => e.status === 403);
  await setSub('entreprise');
  await assertFeature(fx.tenantId, 'advanced_accounting');
});

test('abonnement expiré : coupure immédiate (402)', async () => {
  await setSub('pro', 'active', 'DATE_SUB(NOW(), INTERVAL 1 SECOND)');
  const ent = await getEntitlements(fx.tenantId);
  assert.equal(ent.active, false);
  const r = await call('GET', '/api/payslips');
  assert.equal(r.status, 402);
});

test('indicateur désactivé : comportement actuel inchangé (tout autorisé)', async () => {
  config.features.subscriptionsEnforced = false;
  try {
    await setSub(null, 'pending_payment', 'NULL');
    await assertFeature(fx.tenantId, 'advanced_accounting');
    const c = await pool.getConnection();
    await assertWithinLimit(fx.tenantId, 'users', c);
    c.release();
  } finally { config.features.subscriptionsEnforced = true; }
});

test('assistant IA : routes non montées par défaut', async () => {
  assert.equal(config.features.assistant, false);
  await setSub('pro');
  const r = await call('GET', '/api/assistant/settings');
  assert.equal(r.status, 404);
});

test('portail propriétaire public : fermé hors offre ou abonnement expiré, ouvert avec Pro', async () => {
  const { hashToken } = require('../src/utils/tokens');
  const tok = 'owner-portal-token-'.padEnd(40, 'x');
  await pool.query('UPDATE owners SET portal_token_hash = :h WHERE id = :id', { h: hashToken(tok), id: fx.ownerId });
  const get = async () => (await fetch(`${base}/api/owner-portal/${tok}`)).status;
  await setSub('demarrage');
  assert.equal(await get(), 403);
  await setSub('pro', 'active', 'DATE_SUB(NOW(), INTERVAL 1 SECOND)');
  assert.equal(await get(), 403);
  await setSub('pro');
  assert.equal(await get(), 200);
});

test('locataires : le portail et le paiement restent ouverts quand l’entreprise est expirée', async () => {
  const { hashToken } = require('../src/utils/tokens');
  const tok = 'renter-portal-token-'.padEnd(40, 'y');
  await pool.query('UPDATE renters SET portal_token_hash = :h WHERE id = :id', { h: hashToken(tok), id: fx.renterId });
  await setSub('pro', 'active', 'DATE_SUB(NOW(), INTERVAL 1 SECOND)');
  const r = await fetch(`${base}/api/portal/${tok}`);
  assert.equal(r.status, 200);
});

test('coupure serveur : entreprise expirée => 402 sur les routes de base, /auth et /billing restent ouverts', async () => {
  await setSub('pro', 'active', 'DATE_SUB(NOW(), INTERVAL 1 DAY)');
  for (const path of ['/api/renters', '/api/owners', '/api/properties', '/api/employees', '/api/settings', '/api/charges']) {
    const r = await call('GET', path);
    assert.equal(r.status, 402, path);
    assert.match(JSON.stringify(r.body), /SUBSCRIPTION_INACTIVE/, path);
  }
  const billing = await call('GET', '/api/billing/subscription');
  assert.notEqual(billing.status, 402);
  const health = await call('GET', '/api/health');
  assert.equal(health.status, 200);
  await setSub('pro');
  const ok = await call('GET', '/api/renters');
  assert.equal(ok.status, 200);
});

test('vitrine publique et tâches planifiées : ignorées pour une entreprise expirée', async () => {
  const { listActiveTenantIds } = require('../src/services/entitlements');
  await setSub('pro');
  assert.ok((await listActiveTenantIds()).includes(fx.tenantId));
  assert.equal((await fetch(`${base}/api/marketplace/public/${fx.tenantId}`)).status, 200);
  await setSub('pro', 'active', 'DATE_SUB(NOW(), INTERVAL 1 DAY)');
  assert.ok(!(await listActiveTenantIds()).includes(fx.tenantId));
  assert.equal((await fetch(`${base}/api/marketplace/public/${fx.tenantId}`)).status, 404);
  await setSub('pro');
});

test('dépassement de limites (baisse d’offre) : détecté et affiché dans la description de l’abonnement', async () => {
  const { listOverLimits } = require('../src/services/entitlements');
  const over = await listOverLimits(fx.tenantId, { units: 100, owners: 0, users: null });
  assert.equal(over.length, 1);
  assert.equal(over[0].kind, 'owners');
  assert.deepEqual(await listOverLimits(fx.tenantId, { units: 100, owners: 100, users: null }), []);
  await setSub('pro');
  const d = await call('GET', '/api/billing/subscription');
  assert.ok(Array.isArray(d.body.overLimits));
});
