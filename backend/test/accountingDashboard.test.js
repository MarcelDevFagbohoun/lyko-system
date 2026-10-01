'use strict';

/**
 * Bug corrigé (audit comptable, étape 51bis, Moyenne #2) : `computeAccountingDashboard`
 * (routes/accounting.js, réutilisé par l'écran, le rapport PDF ET l'assistant IA) ne filtrait les charges
 * SONEB/SBEE impayées que par `status = 'impayee'` — une facture PARTIELLEMENT réglée
 * (`status = 'partiellement_payee'`) disparaissait entièrement du total, contrairement à
 * `GET /api/charges/month-summary` (déjà correct : `status <> 'payee'` + reste dû).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { computeAccountingDashboard } = require('./../src/routes/accounting');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

async function insertCharge({ utilityType, amount, paid = 0 }) {
  const status = paid >= amount ? 'payee' : paid > 0 ? 'partiellement_payee' : 'impayee';
  const [c] = await pool.query(
    `INSERT INTO utility_charges (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by)
     VALUES (:t, :l, :type, '2026-08-01', '2026-08-31', 0, 10, 100, :amount, '2026-08-31', :status, :by)`,
    { t: fx.tenantId, l: fx.leaseId, type: utilityType, amount, status, by: fx.dgId },
  );
  if (paid > 0) {
    await pool.query(
      "INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by) VALUES (:t, :c, :paid, 'especes', '2026-09-01', :by)",
      { t: fx.tenantId, c: c.insertId, paid, by: fx.dgId },
    );
  }
  return c.insertId;
}

test("computeAccountingDashboard — une facture SONEB/SBEE partiellement réglée compte son RESTE DÛ, jamais zéro", async () => {
  await insertCharge({ utilityType: 'sbee', amount: 12000, paid: 4000 }); // reste 8000, 'partiellement_payee'
  await insertCharge({ utilityType: 'soneb', amount: 5000, paid: 0 }); // reste 5000, 'impayee'
  await insertCharge({ utilityType: 'sbee', amount: 9000, paid: 9000 }); // soldée, 'payee' — jamais comptée

  const dashboard = await computeAccountingDashboard(
    { tenantId: fx.tenantId, role: 'dg', id: fx.dgId },
    { from: '2026-08-01', to: '2026-08-31' },
  );

  assert.equal(dashboard.totals.unpaidCharges, 13000, 'reste dû : 8000 (partielle) + 5000 (impayée), jamais le montant facturé en entier ni 0 pour la partielle');
  assert.equal(dashboard.totals.unpaidChargesCount, 2, 'la facture soldée ne doit jamais être comptée');

  const byType = Object.fromEntries(dashboard.unpaidChargesByType.map((r) => [r.utilityType, r.total]));
  assert.equal(byType.sbee, 8000, 'le reste dû de la facture SBEE partiellement réglée, jamais 12000 ni 0');
  assert.equal(byType.soneb, 5000);
});
