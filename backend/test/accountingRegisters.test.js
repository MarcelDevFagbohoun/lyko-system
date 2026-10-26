'use strict';

/**
 * Lectures des registres de la page Comptabilité (`services/accountingRegisters.js`) : arriérés de charges
 * SONEB/SBEE, paiements de loyer et versements aux propriétaires — jusqu'ici sans test.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { listUtilityArrearsRows, listRentPaymentRows, listOwnerPayoutRows } = require('../src/services/accountingRegisters');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('listUtilityArrearsRows — une facture partiellement réglée est listée avec son total payé, une facture soldée jamais', async () => {
  const mk = async (status, amount, paid) => {
    const [c] = await pool.query(
      `INSERT INTO utility_charges (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by)
       VALUES (:t, :l, 'sbee', '2026-08-01', '2026-08-31', 0, 10, 100, :amount, '2026-08-31', :status, :by)`,
      { t: fx.tenantId, l: fx.leaseId, amount, status, by: fx.dgId },
    );
    if (paid > 0) {
      await pool.query(
        "INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by) VALUES (:t, :c, :paid, 'especes', '2026-09-01', :by)",
        { t: fx.tenantId, c: c.insertId, paid, by: fx.dgId },
      );
    }
    return c.insertId;
  };
  const partial = await mk('partiellement_payee', 12000, 4000);
  await mk('payee', 9000, 9000);

  const rows = await listUtilityArrearsRows(fx.tenantId, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].charge_id, partial);
  assert.equal(Number(rows[0].amount) - Number(rows[0].paid_total), 8000);
});

test('listUtilityArrearsRows — un agent dont aucun Bien ne correspond ne voit rien', async () => {
  const rows = await listUtilityArrearsRows(fx.tenantId, 987654321);
  assert.deepEqual(rows, []);
});

test('listRentPaymentRows / listOwnerPayoutRows — périodes sans mouvement : listes vides', async () => {
  assert.deepEqual(await listRentPaymentRows(fx.tenantId, '2020-01-01', '2020-01-31'), []);
  assert.deepEqual(await listOwnerPayoutRows(fx.tenantId, '2020-01-01', '2020-01-31'), []);
});
