'use strict';
/** Bilan détaillé d'un mois : chiffres par rubrique, deux « nets » séparés, contrôles croisés. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { getMonthBilan, storeBilanSnapshot, getStoredBilan } = require('../src/services/monthBilan');
const { createFixture, teardown } = require('./gl/fixtures');

let fx;
test.before(async () => {
  fx = await createFixture();
  const T = fx.tenantId;
  const q = (sql, p) => pool.query(sql, { T, o: fx.ownerId, l: fx.leaseId, p: fx.propertyId, by: fx.dgId, ...p });
  await q("INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, ends_on, set_by) VALUES (:T,:o,10,'2026-01-01','2026-09-30',:by)");
  await q("INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, set_by) VALUES (:T,:o,15,'2026-10-01',:by)");
  const rent = (c, a, d) =>
    q("INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by) VALUES (:T,:l,:c,:cs,:a,'virement',:d,:by)", { c, cs: `${c}-01`, a, d });
  await rent('2026-09', 50000, '2026-09-03');
  await rent('2026-10', 50000, '2026-09-28');
  await rent('2026-11', 50000, '2026-09-28');
  await rent('2026-10', 20000, '2026-10-05');
  await q("INSERT INTO expenses (tenant_id, category, property_id, label, amount, expense_date, payment_status, paid_at, payment_method, recorded_by) VALUES (:T,'autre',:p,'Plomberie',15000,'2026-10-20','paid','2026-10-20','especes',:by)");
  await q("INSERT INTO expenses (tenant_id, category, label, amount, expense_date, payment_status, paid_at, payment_method, recorded_by) VALUES (:T,'autre','Papeterie',8000,'2026-10-21','paid','2026-10-21','especes',:by)");
  await q("INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, recorded_by) VALUES (:T,:o,40000,'Sept','2026-10-15','virement',:by)");
});
test.after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('septembre : loyers ventilés mois / avance, commission 10 %, contrôles OK', async () => {
  const b = await getMonthBilan(fx.tenantId, '2026-09');
  assert.equal(b.inflows.rent.total, 150000);
  assert.equal(b.inflows.rent.ceMois, 50000);
  assert.equal(b.inflows.rent.avance, 100000);
  assert.equal(b.treasury.net, 150000);
  assert.equal(b.cabinet.commission, 15000);
  assert.equal(b.cabinet.netIncome, 15000);
  assert.equal(b.owners[0].closingBalance, 135000);
  assert.deepEqual(b.controls.filter((c) => !c.ok), []);
});

test('octobre : deux nets séparés (trésorerie réelle ≠ résultat du cabinet), soldes propriétaire', async () => {
  const b = await getMonthBilan(fx.tenantId, '2026-10');
  assert.equal(b.inflows.total, 20000);
  assert.equal(b.outflows.total, 40000 + 15000 + 8000);
  assert.equal(b.treasury.net, -43000);
  assert.equal(b.cabinet.commission, 750); // 15 % × (20 000 − 15 000)
  assert.equal(b.cabinet.netIncome, 750 - 8000);
  const o = b.owners[0];
  assert.equal(o.openingBalance, 135000);
  assert.equal(o.payouts, 40000);
  assert.equal(o.closingBalance, 135000 + 5000 - 750 - 40000);
  assert.equal(b.properties[0].netRevenue, 5000);
  assert.deepEqual(b.controls.filter((c) => !c.ok), []);
});

test('photo figée : relue telle quelle', async () => {
  await storeBilanSnapshot(fx.tenantId, '2026-09', fx.dgId);
  const stored = await getStoredBilan(fx.tenantId, '2026-09');
  assert.equal(stored.snapshot.treasury.net, 150000);
});

test('frais d\'agence, caution, prorata : entrées du mois sans toucher le revenu propriétaire', async () => {
  await pool.query(
    `UPDATE leases SET entry_fee_amount = 30000, entry_fee_received_at = '2026-08-04', entry_fee_received_method = 'especes',
       deposit_amount = 100000, deposit_received_at = '2026-08-04', deposit_received_method = 'especes' WHERE id = :l`,
    { l: fx.leaseId },
  );
  const b = await getMonthBilan(fx.tenantId, '2026-08');
  assert.equal(b.inflows.lines.entryFees, 30000);
  assert.equal(b.inflows.lines.rentDeposits, 100000);
  assert.equal(b.treasury.net, 130000, 'tout l’argent entré compte dans la trésorerie');
  assert.equal(b.cabinet.netIncome, 30000, 'seuls les frais d’agence reviennent au cabinet (la caution est à rendre)');
  assert.equal(b.owners.length, 0, 'aucun flux propriétaire ce mois-là');
});
