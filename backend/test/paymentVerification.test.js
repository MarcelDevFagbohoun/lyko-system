'use strict';

/**
 * Bug corrigé (audit sécurité/logique, étape 49) : `verifyAndRecordKkiapay`
 * marquait un lien de paiement `payment_links.status = 'paid'` pour TOUTE
 * transaction KKiaPay confirmée, sans jamais comparer son montant à celui
 * réellement attendu (`payment_links.amount`). Un montant confirmé
 * insuffisant affichait quand même « réglé » au personnel. Ce test vérifie
 * que le lien ne passe à 'paid' que si le montant confirmé couvre le
 * montant demandé — l'argent reçu reste toujours crédité au bail dans les
 * deux cas (jamais refusé).
 */

const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { hashToken } = require('../src/utils/tokens');
const kkiapay = require('../src/services/kkiapay');
const { verifyAndRecordKkiapay } = require('../src/services/paymentVerification');

let fx;
let tenant;

before(async () => {
  fx = await createBareFixture();
  await pool.query(
    "UPDATE tenants SET kkiapay_enabled = 1, kkiapay_sandbox = 1, kkiapay_public_key = 'pk_test' WHERE id = :id",
    { id: fx.tenantId },
  );
  const [rows] = await pool.query('SELECT * FROM tenants WHERE id = :id', { id: fx.tenantId });
  tenant = rows[0];
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

async function createPaymentLink(amount) {
  const token = `tok-${Math.random().toString(36).slice(2)}`;
  const [result] = await pool.query(
    `INSERT INTO payment_links (tenant_id, kind, lease_id, amount, token_hash, created_by, expires_at)
     VALUES (:tenantId, 'loyer', :leaseId, :amount, :tokenHash, :by, DATE_ADD(NOW(), INTERVAL 2 DAY))`,
    { tenantId: fx.tenantId, leaseId: fx.leaseId, amount, tokenHash: hashToken(token), by: fx.dgId },
  );
  return { linkId: result.insertId, token };
}

test('verifyAndRecordKkiapay — montant confirmé INSUFFISANT : paiement crédité, mais le lien reste "pending"', async (t) => {
  const { linkId } = await createPaymentLink(50000);
  t.mock.method(kkiapay, 'verifyTransaction', async () => ({
    success: true,
    status: 'SUCCESS',
    amount: 20000,
    raw: {},
  }));

  const result = await verifyAndRecordKkiapay({
    tenant,
    transactionId: `tx-insuffisant-${Date.now()}`,
    kind: 'rent',
    leaseId: fx.leaseId,
    linkId,
  });
  assert.equal(result.alreadyRecorded, false);
  assert.equal(result.amount, 20000);

  const [[payment]] = await pool.query(
    'SELECT amount FROM rent_payments WHERE lease_id = :leaseId AND kkiapay_transaction_id IS NOT NULL',
    { leaseId: fx.leaseId },
  );
  assert.equal(Number(payment.amount), 20000, "le montant réellement confirmé doit être crédité, jamais celui du lien");

  const [[link]] = await pool.query('SELECT status FROM payment_links WHERE id = :id', { id: linkId });
  assert.equal(link.status, 'pending', "un montant insuffisant ne doit jamais marquer le lien comme réglé");
});

test('verifyAndRecordKkiapay — montant confirmé suffisant (ou supérieur) : le lien passe bien à "paid"', async (t) => {
  const { linkId } = await createPaymentLink(30000);
  t.mock.method(kkiapay, 'verifyTransaction', async () => ({
    success: true,
    status: 'SUCCESS',
    amount: 30000,
    raw: {},
  }));

  await verifyAndRecordKkiapay({
    tenant,
    transactionId: `tx-suffisant-${Date.now()}`,
    kind: 'rent',
    leaseId: fx.leaseId,
    linkId,
  });

  const [[link]] = await pool.query('SELECT status, kkiapay_transaction_id FROM payment_links WHERE id = :id', { id: linkId });
  assert.equal(link.status, 'paid');
  assert.ok(link.kkiapay_transaction_id);
});

test('verifyAndRecordKkiapay — refuse un paiement (loyer) si le mois en cours est déjà clôturé (Haute #4, étape 51)', async (t) => {
  const period = new Date().toISOString().slice(0, 7);
  await pool.query('INSERT INTO accounting_periods (tenant_id, period, closed_by) VALUES (:t, :period, :by)', {
    t: fx.tenantId,
    period,
    by: fx.dgId,
  });
  t.mock.method(kkiapay, 'verifyTransaction', async () => ({ success: true, status: 'SUCCESS', amount: 15000, raw: {} }));
  const [[before]] = await pool.query(
    'SELECT COUNT(*) AS n FROM rent_payments WHERE lease_id = :leaseId AND kkiapay_transaction_id IS NOT NULL',
    { leaseId: fx.leaseId },
  );
  try {
    await assert.rejects(
      verifyAndRecordKkiapay({ tenant, transactionId: `tx-cloture-${Date.now()}`, kind: 'rent', leaseId: fx.leaseId }),
      /clôturé/i,
    );
    const [[after]] = await pool.query(
      'SELECT COUNT(*) AS n FROM rent_payments WHERE lease_id = :leaseId AND kkiapay_transaction_id IS NOT NULL',
      { leaseId: fx.leaseId },
    );
    assert.equal(Number(after.n), Number(before.n), 'aucun paiement KKiaPay ne doit être enregistré sur un mois déjà clôturé');
  } finally {
    await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t AND period = :period', { t: fx.tenantId, period });
  }
});

test('verifyAndRecordKkiapay — refuse un paiement (charge SONEB/SBEE) si le mois en cours est déjà clôturé (Haute #4, étape 51)', async (t) => {
  const period = new Date().toISOString().slice(0, 7);
  const [charge] = await pool.query(
    `INSERT INTO utility_charges (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by)
     VALUES (:t, :l, 'sbee', '2026-08-01', '2026-08-31', 0, 10, 100, 5000, '2026-08-31', 'impayee', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  await pool.query('INSERT INTO accounting_periods (tenant_id, period, closed_by) VALUES (:t, :period, :by)', {
    t: fx.tenantId,
    period,
    by: fx.dgId,
  });
  t.mock.method(kkiapay, 'verifyTransaction', async () => ({ success: true, status: 'SUCCESS', amount: 5000, raw: {} }));
  try {
    await assert.rejects(
      verifyAndRecordKkiapay({ tenant, transactionId: `tx-cloture-charge-${Date.now()}`, kind: 'charge', chargeId: charge.insertId }),
      /clôturé/i,
    );
    const [[count]] = await pool.query(
      'SELECT COUNT(*) AS n FROM utility_payments WHERE charge_id = :id',
      { id: charge.insertId },
    );
    assert.equal(Number(count.n), 0, 'aucun paiement KKiaPay ne doit être enregistré sur un mois déjà clôturé');
  } finally {
    await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t AND period = :period', { t: fx.tenantId, period });
    await pool.query('DELETE FROM utility_charges WHERE id = :id', { id: charge.insertId });
  }
});
