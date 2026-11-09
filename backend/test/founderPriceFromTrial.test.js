'use strict';
process.env.SUBSCRIPTIONS_ENFORCED = 'true';

/**
 * Régression : le tarif fondateur doit s'appliquer au tout premier achat payant, même quand l'entreprise est
 * passée par l'essai gratuit avant (cas réel de toute nouvelle inscription depuis que l'essai gratuit est l'offre
 * par défaut — `createInitialSubscription` dans entitlements.js). Avant le correctif, `quote()` ne proposait le
 * tarif fondateur que pour un `kind === 'purchase'` ; or passer de l'essai gratuit à une offre payante est toujours
 * classé `kind === 'upgrade'` (l'essai est "en cours"), donc le tarif fondateur n'était en réalité jamais appliqué.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const config = require('../src/config/env');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { FOUNDER_OFFER } = require('../src/constants/plans');
const planCatalog = require('../src/services/planCatalog');

const realFetch = global.fetch;
let fx; let server; let base; let originalCatalogSettings;

function mock() {
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('fedapay.com') || u.includes('process.fedapay.com')) return realFetch(url, init);
    const path = new URL(u).pathname;
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    const body = init.body ? JSON.parse(init.body) : null;
    if (init.method === 'POST' && path === '/v1/transactions') {
      return json({ 'v1/transaction': { id: 42424, status: 'pending', amount: body.amount, custom_metadata: body.custom_metadata } });
    }
    const m = path.match(/^\/v1\/transactions\/(\d+)\/token$/);
    if (init.method === 'POST' && m) return json({ token: 'tok', url: 'https://sandbox-process.fedapay.com/abc' });
    return json({ message: 'inconnu' }, 404);
  };
}

const hdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}`, 'Content-Type': 'application/json' });
const api = (method, path, body) =>
  realFetch(base + path, { method, headers: hdr(), body: body ? JSON.stringify(body) : undefined });

before(async () => {
  mock();
  config.platform.fedapaySecretKey = 'sk_platform_SECRET';
  fx = await createBareFixture();
  // Reproduit exactement l'état réel d'une nouvelle entreprise : essai gratuit actif (createInitialSubscription).
  await pool.query(
    `INSERT INTO tenant_subscriptions (tenant_id, plan_key, status, period_months, started_at, current_period_end)
     VALUES (:t, 'essai-gratuit', 'active', 1, NOW(), DATE_ADD(NOW(), INTERVAL 1 MONTH))
     ON DUPLICATE KEY UPDATE plan_key = 'essai-gratuit', status = 'active', period_months = 1, started_at = NOW(), current_period_end = DATE_ADD(NOW(), INTERVAL 1 MONTH)`,
    { t: fx.tenantId },
  );
  [[originalCatalogSettings]] = await pool.query('SELECT data FROM catalog_settings WHERE id = 1');
  const c = await planCatalog.getCatalog();
  await pool.query(
    'INSERT INTO catalog_settings (id, data) VALUES (1, :d) ON DUPLICATE KEY UPDATE data = VALUES(data)',
    { d: JSON.stringify({ ...c, enabledPlans: { ...c.enabledPlans, demarrage: true, pro: true, entreprise: true } }) },
  );
  planCatalog.invalidate();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  global.fetch = realFetch;
  server.close();
  await pool.query('DELETE FROM subscription_payments WHERE tenant_id = :t', { t: fx.tenantId });
  if (originalCatalogSettings) await pool.query('UPDATE catalog_settings SET data = :d WHERE id = 1', { d: originalCatalogSettings.data });
  else await pool.query('DELETE FROM catalog_settings WHERE id = 1');
  planCatalog.invalidate();
  await teardown(fx.tenantId);
  await closePool();
});

test('devis : tarif fondateur appliqué pour le premier achat payant venant de l’essai gratuit', async () => {
  const r = await (await api('POST', '/api/billing/quote', { planKey: 'pro', months: 4 })).json();
  assert.equal(r.kind, 'upgrade'); // classé "upgrade" en interne (essai en cours), mais reste un 1er achat
  assert.equal(r.fromPlan, 'essai-gratuit');
  assert.equal(r.founder, true);
  assert.equal(r.price, FOUNDER_OFFER.price);
  assert.equal(r.credit, 0); // l'essai gratuit ne génère aucun crédit (aucun paiement payé derrière)
});

test('achat : le montant réellement facturé est bien le tarif fondateur, pas le plein tarif', async () => {
  const r = await (await api('POST', '/api/billing/checkout', { planKey: 'pro', months: 4 })).json();
  assert.equal(r.founder, true);
  assert.equal(r.amount, FOUNDER_OFFER.price);
  assert.notEqual(r.amount, 65000);
});
