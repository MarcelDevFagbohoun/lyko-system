'use strict';
/** Journal d'activité : filtres par jour, mois et type d'activité (listRecentActivity). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { listRecentActivity } = require('../src/services/activity');
const { createFixture, teardown } = require('./gl/fixtures');

let fx;
test.before(async () => {
  fx = await createFixture();
  const T = fx.tenantId;
  const q = (sql, p) => pool.query(sql, { T, l: fx.leaseId, p: fx.propertyId, by: fx.dgId, ...p });

  await q(
    `INSERT INTO expenses (tenant_id, category, property_id, label, amount, expense_date, payment_status, paid_at, payment_method, recorded_by, created_at)
     VALUES (:T,'autre',:p,'Dépense début mars',10000,'2026-03-05','paid','2026-03-05','especes',:by,'2026-03-05 09:00:00')`,
  );
  await q(
    `INSERT INTO expenses (tenant_id, category, property_id, label, amount, expense_date, payment_status, paid_at, payment_method, recorded_by, created_at)
     VALUES (:T,'autre',:p,'Dépense mi-mars',20000,'2026-03-15','paid','2026-03-15','especes',:by,'2026-03-15 09:00:00')`,
  );
  await q(
    `INSERT INTO expenses (tenant_id, category, property_id, label, amount, expense_date, payment_status, paid_at, payment_method, recorded_by, created_at)
     VALUES (:T,'autre',:p,'Dépense avril',30000,'2026-04-01','paid','2026-04-01','especes',:by,'2026-04-01 09:00:00')`,
  );
  await q(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by, created_at)
     VALUES (:T,:l,'2026-03','2026-03-01',50000,'virement','2026-03-15',:by,'2026-03-15 10:00:00')`,
  );
});
test.after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('filtre par jour : ne retient que les actions de cette date précise, tous types', async () => {
  const entries = await listRecentActivity(fx.tenantId, 60, null, { date: '2026-03-15' });
  assert.equal(entries.length, 2);
  assert.deepEqual(new Set(entries.map((e) => e.type)), new Set(['expense_recorded', 'rent_payment_recorded']));
  assert.ok(entries.every((e) => e.at.toISOString().slice(0, 10) === '2026-03-15'));
});

test('filtre par mois : toutes les actions du mois, pas celles du mois suivant', async () => {
  const entries = await listRecentActivity(fx.tenantId, 60, null, { month: '2026-03' });
  const expenseLabels = entries.filter((e) => e.type === 'expense_recorded').map((e) => e.label);
  assert.equal(expenseLabels.length, 2);
  assert.ok(expenseLabels.some((l) => l.includes('Dépense début mars')));
  assert.ok(expenseLabels.some((l) => l.includes('Dépense mi-mars')));
  assert.ok(!expenseLabels.some((l) => l.includes('Dépense avril')));
  assert.ok(entries.some((e) => e.type === 'rent_payment_recorded'));
});

test('filtre par type : uniquement les dépenses enregistrées, aucun paiement de loyer', async () => {
  const entries = await listRecentActivity(fx.tenantId, 60, null, { type: 'expense_recorded' });
  assert.ok(entries.length >= 3);
  assert.ok(entries.every((e) => e.type === 'expense_recorded'));
});

test('filtres combinés (jour + type) : une seule entrée', async () => {
  const entries = await listRecentActivity(fx.tenantId, 60, null, { date: '2026-03-15', type: 'expense_recorded' });
  assert.equal(entries.length, 1);
  assert.ok(entries[0].label.includes('Dépense mi-mars'));
});

test('sans filtre : comportement inchangé, toutes les actions récentes tous types confondus', async () => {
  const entries = await listRecentActivity(fx.tenantId, 60);
  const types = new Set(entries.map((e) => e.type));
  assert.ok(types.has('expense_recorded'));
  assert.ok(types.has('rent_payment_recorded'));
  assert.ok(types.has('lease_created'));
});
