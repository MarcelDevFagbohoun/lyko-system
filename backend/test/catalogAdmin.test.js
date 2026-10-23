'use strict';
process.env.SUBSCRIPTIONS_ENFORCED = 'true';

/** Modification des offres depuis le back-office. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken, signAdminToken } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const planCatalog = require('../src/services/planCatalog');
const { assertFeature, assertWithinLimit } = require('../src/services/entitlements');
const { quote } = require('../src/services/billing');

let fx; let server; let base; let adminId; let adminToken; let original;
const adHdr = () => ({ Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' });
const put = (body) => fetch(`${base}/api/admin/catalog`, { method: 'PUT', headers: adHdr(), body: JSON.stringify(body) });
const current = async () => (await (await fetch(`${base}/api/admin/catalog`, { headers: adHdr() })).json()).catalog;

before(async () => {
  [[original]] = await pool.query('SELECT data FROM catalog_settings WHERE id = 1');
  await pool.query('DELETE FROM catalog_settings WHERE id = 1');
  planCatalog.invalidate();
  fx = await createBareFixture();
  const [a] = await pool.query("INSERT INTO platform_admins (email, name, password_hash) VALUES (:e, 'Admin Cat', :h)", { e: `cat-${Date.now()}@aim.test`, h: await hashPassword('motdepasse-solide-1') });
  adminId = a.insertId;
  adminToken = signAdminToken({ sub: adminId });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM catalog_settings WHERE id = 1');
  if (original) await pool.query('INSERT INTO catalog_settings (id, data) VALUES (1, :d)', { d: original.data });
  planCatalog.invalidate();
  await pool.query('DELETE FROM subscription_payments WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM catalog_changes WHERE admin_id = :a', { a: adminId });
  await pool.query('DELETE FROM platform_admins WHERE id = :id', { id: adminId });
  await teardown(fx.tenantId);
  await closePool();
});

test('accès réservé à l’administrateur de la plateforme', async () => {
  const dg = { Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/api/admin/catalog`, { headers: dg })).status, 401);
  assert.equal((await fetch(`${base}/api/admin/catalog`)).status, 401);
});

test('valeurs par défaut du code quand rien n’est enregistré', async () => {
  const c = await current();
  assert.equal(c.plans.pro.offers[0].price, 65000);
  assert.equal(c.founder.price, 49000);
  assert.equal(c.refundWindowDays, 15);
});

test('validation : prix, durées, fonctions de base, tarif fondateur', async () => {
  const base0 = await current();
  const bad = async (mutate, msg) => { const c = JSON.parse(JSON.stringify(base0)); mutate(c); assert.equal((await put(c)).status, 400, msg); };
  await bad((c) => { c.plans.pro.offers[0].price = 5; }, 'prix trop bas');
  await bad((c) => { c.plans.pro.offers = []; }, 'aucune durée');
  await bad((c) => { c.plans.pro.offers.push({ months: 4, price: 70000 }); }, 'durée en double');
  await bad((c) => { c.plans.demarrage.features = ['core']; }, 'fonctions de base retirées');
  await bad((c) => { c.plans.pro.features.push('ai_assistant'); }, 'assistant IA non activable');
  await bad((c) => { c.plans.pro.features.push('inconnue'); }, 'fonction inconnue');
  await bad((c) => { c.founder.price = 70000; }, 'prix fondateur ≥ prix normal');
  await bad((c) => { c.founder.months = 7; }, 'durée fondateur inexistante');
  await bad((c) => { c.plans.pro.featured = true; c.plans.entreprise.featured = true; }, 'deux recommandées');
  await bad((c) => { c.plans.demarrage.limits.units = 0; }, 'limite nulle');
  assert.equal((await current()).plans.pro.offers[0].price, 65000); // rien n'a été enregistré
});

test('changer les prix : appliqué aux achats futurs, tarif fondateur désactivable, historique tracé', async () => {
  const c = await current();
  c.plans.pro.offers[0].price = 70000;
  c.plans.demarrage.offers.push({ months: 3, price: 30000 });
  c.founder.price = 55000;
  assert.equal((await put(c)).status, 200);
  let q = await quote(fx.tenantId, 'pro', 4);
  assert.equal(q.normalPrice, 70000);
  assert.equal(q.price, 55000);
  assert.equal((await quote(fx.tenantId, 'demarrage', 3)).price, 30000);
  const pub = await (await fetch(`${base}/api/billing/plans`)).json();
  assert.equal(pub.plans.find((p) => p.key === 'pro').offers[0].price, 70000);

  c.founder.enabled = false;
  assert.equal((await put(c)).status, 200);
  q = await quote(fx.tenantId, 'pro', 4);
  assert.equal(q.price, 70000);
  assert.equal(q.founder, false);
  const hist = await (await fetch(`${base}/api/admin/catalog`, { headers: adHdr() })).json();
  assert.ok(hist.changes.length >= 2);
});

test('changer limites et fonctions : effet immédiat sur les entreprises de l’offre', async () => {
  await pool.query("INSERT INTO tenant_subscriptions (tenant_id, plan_key, status, current_period_end) VALUES (:t, 'demarrage', 'active', DATE_ADD(NOW(), INTERVAL 30 DAY)) ON DUPLICATE KEY UPDATE plan_key='demarrage', status='active', current_period_end=VALUES(current_period_end)", { t: fx.tenantId });
  await assert.rejects(() => assertFeature(fx.tenantId, 'payroll'), (e) => e.status === 403);
  const c = await current();
  c.plans.demarrage.features.push('payroll');
  c.plans.demarrage.limits.units = 1; // l'entreprise a déjà 1 unité
  assert.equal((await put(c)).status, 200);
  await assertFeature(fx.tenantId, 'payroll');
  const conn = await pool.getConnection();
  await assert.rejects(() => assertWithinLimit(fx.tenantId, 'units', conn), (e) => e.details.code === 'PLAN_LIMIT_REACHED');
  conn.release();
});

test('réinitialisation : retour aux valeurs du code', async () => {
  const r = await fetch(`${base}/api/admin/catalog/reset`, { method: 'POST', headers: adHdr() });
  assert.equal(r.status, 200);
  const c = await current();
  assert.equal(c.plans.pro.offers[0].price, 65000);
  assert.equal(c.plans.demarrage.limits.units, 50);
});
