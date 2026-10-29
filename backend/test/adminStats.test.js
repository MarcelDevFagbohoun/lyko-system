'use strict';

/** Tableau de bord du back-office : recettes, évolution, échecs. Les compteurs sont globaux : on compare avant/après nos écritures. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool, closePool } = require('../src/config/db');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken, signAdminToken } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');

let fx; let server; let base; let adminId; let adminToken; let adminEmail;
const adHdr = () => ({ Authorization: `Bearer ${adminToken}` });
const stats = async (q = '') => (await fetch(`${base}/api/admin/stats${q}`, { headers: adHdr() })).json();
async function addPayment({ status, amount, planKey = 'pro', kind = 'purchase', reason = null, paidAt = null, createdAt = null }) {
  await pool.query(
    `INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, kind, amount, status, failure_reason, paid_at, created_at)
     VALUES (:t, :r, :p, 1, :k, :a, :s, :fr, ${paidAt ? 'NOW()' : 'NULL'}, ${createdAt || 'NOW()'})`,
    { t: fx.tenantId, r: crypto.randomBytes(16).toString('hex'), p: planKey, k: kind, a: amount, s: status, fr: reason },
  );
}

before(async () => {
  fx = await createBareFixture();
  adminEmail = `stats-${Date.now()}@aim.test`;
  const [a] = await pool.query("INSERT INTO platform_admins (email, name, password_hash) VALUES (:e, 'Admin Stats', :h)", { e: adminEmail, h: await hashPassword('motdepasse-solide-1') });
  adminId = a.insertId;
  adminToken = signAdminToken({ sub: adminId });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM subscription_payments WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM platform_admins WHERE id = :id', { id: adminId });
  await teardown(fx.tenantId);
  await closePool();
});

test('réservé à l’administrateur de la plateforme', async () => {
  assert.equal((await fetch(`${base}/api/admin/stats`)).status, 401);
  const dg = { Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}` };
  assert.equal((await fetch(`${base}/api/admin/stats`, { headers: dg })).status, 401);
});

test('la durée est bornée et la série contient un mois par ligne, mois courant en dernier', async () => {
  assert.equal((await stats('?months=1')).months, 3);
  assert.equal((await stats('?months=99')).months, 24);
  assert.equal((await stats('?months=abc')).months, 12);
  const s = await stats('?months=6');
  assert.equal(s.series.length, 6);
  const [[{ k }]] = await pool.query("SELECT DATE_FORMAT(NOW(), '%Y-%m') AS k");
  assert.equal(s.series[5].month, k);
  assert.deepEqual(s.series.map((x) => x.month), [...s.series.map((x) => x.month)].sort());
});

test('recettes, échecs, anomalies et offerts sont comptés séparément', async () => {
  const before = await stats('?months=6');
  await addPayment({ status: 'paid', amount: 10000, paidAt: true });
  await addPayment({ status: 'paid', amount: 5000, planKey: 'demarrage', kind: 'renewal', paidAt: true });
  await addPayment({ status: 'paid', amount: 0, paidAt: true }); // offert : jamais une recette
  await addPayment({ status: 'failed', amount: 3000, reason: 'declined' });
  await addPayment({ status: 'anomaly', amount: 2000 });
  await addPayment({ status: 'pending', amount: 4000, createdAt: 'DATE_SUB(NOW(), INTERVAL 3 HOUR)' }); // abandonné
  await addPayment({ status: 'pending', amount: 7000 }); // en cours : ni succès ni échec
  const after = await stats('?months=6');
  const d = (f) => f(after) - f(before);
  assert.equal(d((x) => x.kpis.collectedTotal), 15000);
  assert.equal(d((x) => x.kpis.collectedMonth), 15000);
  assert.equal(d((x) => x.kpis.success30), 2);
  assert.equal(d((x) => x.kpis.failed30), 1);
  assert.equal(d((x) => x.kpis.failedAmount30), 3000);
  assert.equal(d((x) => x.kpis.incomplete30), 1);
  assert.equal(d((x) => x.kpis.anomalies), 1);
  assert.equal(d((x) => x.kpis.anomalyAmount), 2000);
  assert.equal(d((x) => x.series[5].amount), 15000);
  assert.equal(d((x) => x.series[5].payments), 2);
  assert.equal(d((x) => x.series[5].failed), 3); // échoué + anomalie + abandonné
  const planAmount = (x, k) => x.byPlan.find((p) => p.planKey === k)?.amount ?? 0;
  assert.equal(planAmount(after, 'pro') - planAmount(before, 'pro'), 10000);
  assert.equal(planAmount(after, 'demarrage') - planAmount(before, 'demarrage'), 5000);
  const reason = (x, k) => x.failureReasons.find((r) => r.reason === k)?.count ?? 0;
  assert.equal(reason(after, 'declined') - reason(before, 'declined'), 1);
  assert.equal(reason(after, 'anomaly') - reason(before, 'anomaly'), 1);
  assert.equal(reason(after, 'incomplete') - reason(before, 'incomplete'), 1);
  assert.ok(after.kpis.successRate30 >= 0 && after.kpis.successRate30 <= 100);
  assert.ok(after.recent.length <= 10 && after.recent.every((r) => r.amount > 0));
});

test('un paiement ancien alimente le bon mois de la série', async () => {
  const before = await stats('?months=6');
  await pool.query(
    `INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, kind, amount, status, paid_at, created_at)
     VALUES (:t, :r, 'pro', 1, 'purchase', 8000, 'paid', DATE_SUB(NOW(), INTERVAL 2 MONTH), DATE_SUB(NOW(), INTERVAL 2 MONTH))`,
    { t: fx.tenantId, r: crypto.randomBytes(16).toString('hex') },
  );
  const after = await stats('?months=6');
  assert.equal(after.series[3].amount - before.series[3].amount, 8000);
  assert.equal(after.series[5].amount, before.series[5].amount);
  assert.equal(after.kpis.collectedMonth, before.kpis.collectedMonth);
});
