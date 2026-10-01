'use strict';

/**
 * Bug corrigé (audit comptable, étape 51bis, Basse #1) : `nextReceiptNumber` (routes/leases.js) n'est
 * qu'un `COUNT(*)` sur `receipts`, jamais un compteur verrouillé — deux paiements de BAUX DIFFÉRENTS
 * enregistrés au même instant pouvaient calculer le même numéro avant que l'un des deux ne commite, et la
 * contrainte UNIQUE `uq_receipts_number` faisait alors échouer le second en bloc. `insertReceiptForPayment`
 * retente désormais avec le numéro suivant sur un conflit, au lieu de laisser l'erreur remonter.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { insertReceiptForPayment } = require('../src/routes/leases');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

async function insertRentPayment(coversMonth) {
  const [p] = await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, :coversMonth, 50000, 'especes', '2026-01-05', :by)`,
    { t: fx.tenantId, l: fx.leaseId, coversMonth, by: fx.dgId },
  );
  return p.insertId;
}

test('insertReceiptForPayment — deux paiements enregistrés en VRAIE concurrence obtiennent chacun un numéro de quittance UNIQUE, jamais une erreur', async () => {
  const paymentIdA = await insertRentPayment('2026-01');
  const paymentIdB = await insertRentPayment('2026-02');

  const connA = await pool.getConnection();
  const connB = await pool.getConnection();
  try {
    const [resultA, resultB] = await Promise.all([
      insertReceiptForPayment(connA, fx.tenantId, paymentIdA),
      insertReceiptForPayment(connB, fx.tenantId, paymentIdB),
    ]);
    assert.notEqual(resultA.receiptNumber, resultB.receiptNumber, 'deux numéros distincts, jamais le même');

    const [rows] = await pool.query('SELECT receipt_number FROM receipts WHERE payment_id IN (:a, :b)', {
      a: paymentIdA,
      b: paymentIdB,
    });
    assert.equal(rows.length, 2, 'les deux quittances doivent exister, aucune perdue à une erreur de conflit');
  } finally {
    connA.release();
    connB.release();
  }
});
