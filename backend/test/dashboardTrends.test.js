'use strict';

/** Tendances du tableau de bord DG : chaque point du graphe doit coïncider avec le calcul de l'écran de comptabilité correspondant. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { computeAccountingDashboard } = require('../src/services/accountingDashboard');
const { getCabinetRevenue } = require('../src/services/commission');

let fx; let server; let base;
const now = new Date(Date.now() + 3600 * 1000); // heure du Bénin
const CUR = now.toISOString().slice(0, 7);
const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const PREV = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
const hdr = (role = 'dg') => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role })}` });
const trends = async (q = '') => (await fetch(`${base}/api/dashboard/trends${q}`, { headers: hdr() })).json();
const rent = (amount, date) => pool.query(
  "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by) VALUES (:t, :l, :m, STR_TO_DATE(CONCAT(:m, '-01'), '%Y-%m-%d'), :a, 'especes', :d, :by)",
  { t: fx.tenantId, l: fx.leaseId, m: date.slice(0, 7), a: amount, d: date, by: fx.dgId },
);

before(async () => {
  fx = await createBareFixture();
  await pool.query("UPDATE property_units SET created_at = '2026-01-01 08:00:00' WHERE tenant_id = :t", { t: fx.tenantId });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM rent_payments WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM expenses WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM other_incomes WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

test('réservé au DG', async () => {
  assert.equal((await fetch(`${base}/api/dashboard/trends`)).status, 401);
  assert.equal((await fetch(`${base}/api/dashboard/trends`, { headers: hdr('comptable') })).status, 403);
});

test('durée bornée ; un mois par ligne, mois courant en dernier ; cumul sans décroissance', async () => {
  assert.equal((await trends('?months=1')).months, 3);
  assert.equal((await trends('?months=99')).months, 12);
  assert.equal((await trends('?months=abc')).months, 6);
  const t = await trends('?months=6');
  assert.equal(t.series.length, 6);
  assert.equal(t.series[5].month, CUR);
  assert.equal(t.series[4].month, PREV);
  assert.equal(t.daily.current.length, t.daily.today);
  assert.equal(t.daily.previous.length, t.daily.daysInPrevious);
  for (const arr of [t.daily.current, t.daily.previous]) assert.ok(arr.every((v, i) => i === 0 || v >= arr[i - 1]));
});

test('loyers encaissés : mois, cumul jour par jour et accord avec le tableau de comptabilité', async () => {
  await rent(50000, `${PREV}-10`);
  await rent(30000, `${PREV}-20`);
  await rent(50000, `${CUR}-01`);
  const t = await trends('?months=6');
  assert.equal(t.series[4].rentCollected, 80000);
  assert.equal(t.series[4].rentPayments, 2);
  assert.equal(t.series[5].rentCollected, 50000);
  assert.equal(t.daily.previous[8], 0); assert.equal(t.daily.previous[9], 50000); assert.equal(t.daily.previous[19], 80000);
  assert.equal(t.daily.previous[t.daily.daysInPrevious - 1], 80000);
  assert.equal(t.daily.current[0], 50000);
  for (const m of [PREV, CUR]) {
    const [y, mo] = m.split('-').map(Number);
    const dash = await computeAccountingDashboard({ tenantId: fx.tenantId, role: 'dg', id: fx.dgId }, { from: `${m}-01`, to: `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}` });
    assert.equal(t.series.find((s) => s.month === m).rentCollected, dash.totals.rentCollected, `loyers ≠ comptabilité en ${m}`);
    assert.equal(t.series.find((s) => s.month === m).arrears, dash.totals.tenantArrears, `impayés ≠ comptabilité en ${m}`);
  }
});

test('recette du cabinet et dépenses : mêmes valeurs que getCabinetRevenue, dépenses ventilées par catégorie', async () => {
  await pool.query(
    `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, payment_method, payment_status, paid_at, recorded_by) VALUES
     (:t, 'fournitures', 'Papier', 7000, :d, 'especes', 'paid', :d, :by),
     (:t, 'transport', 'Taxi', 3000, :d, 'especes', 'paid', :d, :by),
     (:t, 'transport', 'Taxi crédit', 5000, :d, NULL, 'unpaid', NULL, :by)`, // impayée : jamais une sortie d'argent
    { t: fx.tenantId, d: `${CUR}-01`, by: fx.dgId },
  );
  await pool.query("INSERT INTO other_incomes (tenant_id, category, label, amount, income_date, payment_method, recorded_by) VALUES (:t, 'prestation', 'Conseil', 12000, :d, 'especes', :by)", { t: fx.tenantId, d: `${CUR}-01`, by: fx.dgId });
  const t = await trends('?months=6');
  const cur = t.series[5];
  const ref = await getCabinetRevenue(fx.tenantId, CUR);
  assert.equal(cur.revenue.net, ref.netCabinetIncome);
  assert.equal(cur.revenue.expenses, 10000);
  assert.equal(cur.revenue.otherIncomes, 12000);
  assert.equal(cur.expensesByCategory.fournitures, 7000);
  assert.equal(cur.expensesByCategory.transport, 3000);
  assert.equal(Object.values(cur.expensesByCategory).reduce((a, b) => a + b, 0), cur.revenue.expenses);
});

test('occupation : unité louée à partir du bail, absente avant la création de l’unité', async () => {
  const t = await trends('?months=12');
  const cur = t.series[11].occupancy;
  assert.equal(cur.total, 1);
  assert.equal(cur.occupied, 1);
  assert.equal(cur.rate, 1);
  const first = t.series.find((s) => s.month < '2026-01');
  if (first) { assert.equal(first.occupancy.total, 0); assert.equal(first.occupancy.rate, null); }
});
