'use strict';

/** Détail des cartes de la comptabilité : chaque carte = somme exacte de ses lignes datées. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { CARDS } = require('../src/services/accountingCardDetail');

let fx; let server; let base;
const hdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}` });
const get = async (path) => (await fetch(`${base}/api/accounting/${path}`, { headers: hdr() })).json();
const MONTH = '2026-03';
const range = `from=${MONTH}-01&to=${MONTH}-31`;

before(async () => {
  fx = await createFixture();
  const t = fx.tenantId;
  await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at) VALUES
     (:t, :l, '2026-03', '2026-03-01', 40000, 'especes', '2026-03-05'),
     (:t, :l, '2026-02', '2026-02-01', 15000, 'mobile_money', '2026-03-08'),
     (:t, :l, '2026-04', '2026-04-01', 25000, 'virement', '2026-03-20'),
     (:t, :l, '2026-01', '2026-01-01', 99999, 'especes', '2026-02-28')`,
    { t, l: fx.leaseId },
  );
  await pool.query(
    "INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, recorded_by) VALUES (:t, :o, 30000, 'Février', '2026-03-10', 'virement', :by)",
    { t, o: fx.ownerId, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, payment_method, payment_status, paid_at, recorded_by) VALUES
     (:t, 'fournitures', 'Papier', 7000, '2026-03-02', 'especes', 'paid', '2026-03-04', :by),
     (:t, 'transport', 'Taxi crédit', 5000, '2026-03-02', NULL, 'unpaid', NULL, :by)`,
    { t, by: fx.dgId },
  ).catch(() => {});
  await pool.query(
    "INSERT INTO other_incomes (tenant_id, category, label, amount, income_date, payment_method, recorded_by) VALUES (:t, 'prestation', 'Conseil', 12000, '2026-03-12', 'especes', :by), (:t, 'autre', 'Hors période', 999, '2026-04-02', 'especes', :by)",
    { t, by: fx.dgId },
  );
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM other_incomes WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM owner_payouts WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM expenses WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

test('chaque carte : le détail égale le chiffre de la carte du tableau de bord', async () => {
  const dash = (await get(`dashboard?${range}`)).totals;
  const expected = {
    rent: dash.rentCollected, entryFees: dash.entryFeesCollected, saleCommissions: dash.saleCommissionsCollected,
    otherIncomes: dash.otherIncomes, ownerPayouts: dash.ownerPayouts, expenses: dash.expenses,
    propertyExpenses: dash.propertyExpenses, unpaidCharges: dash.unpaidCharges, tenantArrears: dash.tenantArrears,
    treasury: dash.treasuryNet,
  };
  for (const card of CARDS) {
    const d = await get(`card-detail?card=${card}&${range}`);
    assert.equal(d.total, expected[card], `${card} : total du détail ≠ carte`);
    assert.equal(d.matches, true, `${card} : lignes ≠ total`);
  }
});

test('loyers : seuls les paiements datés dans le mois, avec imputation mois en cours / arriéré / avance', async () => {
  const d = await get(`card-detail?card=rent&${range}`);
  assert.equal(d.total, 80000);
  assert.equal(d.rows.length, 3);
  assert.deepEqual(d.rows.map((r) => r.timing), ['Mois en cours', 'Arriéré', "Payé d'avance"]);
  assert.deepEqual(d.rows.map((r) => r.date), ['2026-03-05', '2026-03-08', '2026-03-20']);
});

test('autres entrées et versements : hors période exclus', async () => {
  assert.equal((await get(`card-detail?card=otherIncomes&${range}`)).total, 12000);
  assert.equal((await get(`card-detail?card=ownerPayouts&${range}`)).total, 30000);
  // Dépense payée comptée à sa date de paiement ; la dépense à crédit impayée n'y figure pas.
  assert.equal((await get(`card-detail?card=expenses&${range}`)).total, 7000);
});

test('journal des dépenses aligné sur la carte : payées au mois du paiement, impayées à leur date', async () => {
  const list = async (m) => (await get(`expenses?from=${m}-01&to=${m}-31`)).expenses;
  const mars = await list('2026-03');
  const paid = mars.filter((e) => e.paymentStatus === 'paid' && !e.propertyId).reduce((s, e) => s + e.amount, 0);
  assert.equal(paid, (await get(`card-detail?card=expenses&${range}`)).total);
  assert.ok(mars.some((e) => e.paymentStatus === 'unpaid'), 'la dépense à crédit reste visible dans le journal');
  // Une dépense saisie en mars mais payée en avril n'apparaît plus en mars comme payée.
  await pool.query("UPDATE expenses SET paid_at = '2026-04-03' WHERE tenant_id = :t AND label = 'Papier'", { t: fx.tenantId });
  assert.ok(!(await list('2026-03')).some((e) => e.label === 'Papier'));
  assert.ok((await list('2026-04')).some((e) => e.label === 'Papier'));
});

test('carte inconnue refusée', async () => {
  const r = await fetch(`${base}/api/accounting/card-detail?card=nope&${range}`, { headers: hdr() });
  assert.equal(r.status, 400);
});
