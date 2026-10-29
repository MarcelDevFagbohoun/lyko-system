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
  await pool.query('DELETE FROM subscription_refunds WHERE tenant_id = :t', { t: fx.tenantId });
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
  const [[{ k }]] = await pool.query("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR), '%Y-%m') AS k"); // mois du Bénin (UTC+1)
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

const MID_PREV = "DATE_SUB(DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR), '%Y-%m-15 12:00:00'), INTERVAL 1 MONTH)";

test('comparaison jour par jour : le mois précédent est complet, le mois en cours s’arrête à aujourd’hui', async () => {
  const before = await stats('?months=6');
  await addPayment({ status: 'paid', amount: 10000, paidAt: true });
  await pool.query(
    `INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, kind, amount, status, paid_at, created_at)
     VALUES (:t, :r, 'pro', 1, 'purchase', 8000, 'paid', ${MID_PREV}, ${MID_PREV})`, { t: fx.tenantId, r: crypto.randomBytes(16).toString('hex') });
  const after = await stats('?months=6');
  const b = before.daily; const a = after.daily;
  assert.equal(a.current.length, a.today);
  assert.equal(a.previous.length, a.daysInPrevious);
  assert.ok(a.today >= 1 && a.today <= a.daysInCurrent);
  assert.equal(a.current[a.today - 1] - b.current[b.today - 1], 10000);
  assert.equal(a.previous[13] - b.previous[13], 0); // le 14 : pas encore
  assert.equal(a.previous[14] - b.previous[14], 8000); // le 15 : tombe dans le cumul
  assert.equal(a.previous[a.daysInPrevious - 1] - b.previous[b.daysInPrevious - 1], 8000);
  for (const arr of [a.current, a.previous]) assert.ok(arr.every((v, i) => i === 0 || v >= arr[i - 1]), 'le cumul ne décroît jamais');
});

test('offres et types par mois : chaque mois ventile son encaissé', async () => {
  const before = await stats('?months=6');
  await addPayment({ status: 'paid', amount: 6000, planKey: 'entreprise', kind: 'upgrade', paidAt: true });
  await addPayment({ status: 'paid', amount: 0, planKey: 'entreprise', kind: 'renewal', paidAt: true }); // offert : ignoré
  const after = await stats('?months=6');
  const cur = (x) => x.series[5];
  assert.equal(cur(after).byPlan.entreprise - cur(before).byPlan.entreprise, 6000);
  assert.equal(cur(after).byKind.upgrade - cur(before).byKind.upgrade, 6000);
  assert.equal(cur(after).byKind.renewal - cur(before).byKind.renewal, 0);
  for (const s of after.series) {
    assert.equal(Object.values(s.byPlan).reduce((x, y) => x + y, 0), s.amount, `offres ≠ total en ${s.month}`);
    assert.equal(Object.values(s.byKind).reduce((x, y) => x + y, 0), s.amount, `types ≠ total en ${s.month}`);
  }
});

test('remboursement : retiré du mois où il est versé, jamais du mois du paiement', async () => {
  await addPayment({ status: 'refunded', amount: 20000, paidAt: true });
  const [[pay]] = await pool.query("SELECT id FROM subscription_payments WHERE tenant_id = :t AND status = 'refunded' ORDER BY id DESC LIMIT 1", { t: fx.tenantId });
  const before = await stats('?months=6');
  await pool.query(
    "INSERT INTO subscription_refunds (tenant_id, payment_id, status, reason, amount_paid, fee_amount, refund_amount, paid_at) VALUES (:t, :p, 'paid', 'test', 20000, 2000, 18000, NOW())",
    { t: fx.tenantId, p: pay.id },
  );
  const after = await stats('?months=6');
  assert.equal(after.series[5].refunded - before.series[5].refunded, 18000);
  assert.equal(after.series[5].net - before.series[5].net, -18000);
  assert.equal(after.series[5].amount, before.series[5].amount); // l'encaissé brut ne bouge pas
  assert.equal(after.kpis.refundedTotal - before.kpis.refundedTotal, 18000);
  for (const s of after.series) assert.equal(s.net, s.amount - s.refunded);
});

test('MRR : un abonnement de 3 mois à 30 000 FCFA vaut 10 000 FCFA par mois sur les mois qu’il couvre', async () => {
  const before = await stats('?months=6');
  await pool.query(
    `INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, kind, amount, credit_applied, status, paid_at, period_end)
     VALUES (:t, :r, 'pro', 3, 'purchase', 30000, 0, 'paid', NOW(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MONTH))`, { t: fx.tenantId, r: crypto.randomBytes(16).toString('hex') });
  const after = await stats('?months=6');
  assert.equal(after.series[5].mrr - before.series[5].mrr, 10000); // mois en cours
  assert.equal(after.series[4].mrr - before.series[4].mrr, 10000); // mois précédent : l'abonnement a commencé il y a 1 mois
  assert.equal(after.series[3].mrr - before.series[3].mrr, 0); // avant son début
  assert.equal(after.kpis.mrr, after.series[5].mrr);
  assert.equal(after.kpis.mrrPrevious, after.series[4].mrr);
});
