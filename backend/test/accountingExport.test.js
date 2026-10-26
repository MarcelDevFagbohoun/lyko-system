'use strict';

/**
 * Export comptable Excel (`GET /api/accounting/export.xlsx`, construit par `services/accountingExport.js`) :
 * jusqu'ici aucun test ne le couvrait. Vérifie le registre réellement produit — lignes, sens débit/crédit,
 * totaux, solde net — et le 404 d'une entreprise inconnue.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { buildAccountingExport } = require('../src/services/accountingExport');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('buildAccountingExport — une dépense (débit) et un règlement de charge (crédit) apparaissent avec totaux et solde net', async () => {
  const [exp] = await pool.query(
    `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, payment_method, payment_status, paid_at, recorded_by)
     VALUES (:t, 'fournitures', 'Achat fournitures test', 3000, '2026-08-10', 'especes', 'paid', '2026-08-10', :by)`,
    { t: fx.tenantId, by: fx.dgId },
  );
  assert.ok(exp.insertId);
  const [c] = await pool.query(
    `INSERT INTO utility_charges (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by)
     VALUES (:t, :l, 'sbee', '2026-08-01', '2026-08-31', 0, 10, 100, 1000, '2026-08-31', 'payee', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  await pool.query(
    "INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by) VALUES (:t, :c, 1000, 'especes', '2026-08-15', :by)",
    { t: fx.tenantId, c: c.insertId, by: fx.dgId },
  );

  const { workbook, rowCount } = await buildAccountingExport(fx.tenantId, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(rowCount, 2);

  const sheet = workbook.getWorksheet('Registre comptable');
  // Ligne 3 = en-têtes ; données triées par date : la dépense (10/08) puis le règlement de charge (15/08).
  assert.equal(sheet.getCell(3, 1).value, 'Date');
  assert.equal(sheet.getCell(4, 2).value, 'Dépense (entreprise)');
  assert.equal(sheet.getCell(4, 6).value, 3000, 'dépense = débit');
  assert.equal(sheet.getCell(4, 7).value, null);
  assert.equal(sheet.getCell(5, 2).value, 'Charge SONEB/SBEE réglée');
  assert.equal(sheet.getCell(5, 7).value, 1000, 'règlement de charge = crédit');
  assert.equal(sheet.getCell(5, 5).value, 'SBEE (Électricité)');

  // Totaux : ligne data+2 (TOTAL) puis data+3 (solde net).
  assert.equal(sheet.getCell(3 + rowCount + 2, 5).value, 'TOTAL');
  assert.equal(sheet.getCell(3 + rowCount + 2, 6).value, 3000);
  assert.equal(sheet.getCell(3 + rowCount + 2, 7).value, 1000);
  assert.equal(sheet.getCell(3 + rowCount + 3, 7).value, -2000, 'solde net = crédit − débit');
});

test('buildAccountingExport — entreprise inconnue : 404', async () => {
  await assert.rejects(
    buildAccountingExport(999999999, { from: '2026-08-01', to: '2026-08-31' }),
    (err) => err.status === 404 || err.statusCode === 404,
  );
});
