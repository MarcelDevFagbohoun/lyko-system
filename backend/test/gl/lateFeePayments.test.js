'use strict';

/**
 * Suivi de règlement des pénalités de retard (étape 44bis, migration 069, demande directe de
 * l'utilisateur : « revenons sur les pénalités ») — jusqu'ici (`late_fees`, migration 047) une pénalité
 * appliquée n'avait aucun suivi de règlement : ni statut, ni date de paiement, une créance 411
 * indéfiniment ouverte. `late_fee_payments` (une pénalité peut être réglée en une ou plusieurs fois,
 * comme `lease_opening_debt_payments`) + `penalite_retard_encaissee` (solde la créance, ne recrée
 * JAMAIS le produit 707 déjà reconnu à l'application).
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { backfillHistoricalEntries } = require('../../src/services/gl/glActivationService');
const { listPortfolioArrears } = require('../../src/services/rentTracking');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: fx.tenantId });
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

beforeEach(async () => {
  const p = { tenantId: fx.tenantId };
  await pool.query('DELETE FROM late_fee_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM late_fees WHERE tenant_id = :tenantId', p);
  await pool.query(
    'DELETE el FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id WHERE e.tenant_id = :tenantId',
    p,
  );
  await pool.query('DELETE FROM gl_entries WHERE tenant_id = :tenantId', p);
});

async function insertLateFee(amount = 10000, appliedAt = '2026-08-01') {
  const [row] = await pool.query(
    'INSERT INTO late_fees (tenant_id, lease_id, amount, applied_at, applied_by) VALUES (:t, :l, :amount, :appliedAt, :by)',
    { t: fx.tenantId, l: fx.leaseId, amount, appliedAt, by: fx.dgId },
  );
  return row.insertId;
}

test('genererEcriture — penalite_retard_encaissee : solde le 411 déjà ouvert par penalite_retard, ne recrée jamais le 707', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const applied = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'penalite_retard',
      entryDate: '2026-08-01',
      amount: 10000,
      narrationVars: { locataire: 'Locataire Test' },
      sourceTable: 'late_fees',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    const [appliedLines] = await conn.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: applied.entryId },
    );
    assert.deepEqual(appliedLines.map((l) => [l.side, l.code, Number(l.amount)]), [
      ['debit', '411', 10000],
      ['credit', '707', 10000],
    ]);

    const settled = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'penalite_retard_encaissee',
      entryDate: '2026-08-20',
      amount: 10000,
      paymentMethod: 'mobile_money',
      narrationVars: { locataire: 'Locataire Test' },
      sourceTable: 'late_fee_payments',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    const [settledLines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: settled.entryId },
    );
    assert.deepEqual(settledLines.map((l) => [l.side, l.code, Number(l.amount)]), [
      ['debit', '552', 10000], // mobile_money
      ['credit', '411', 10000],
    ], 'aucune ligne 707 ici — le produit a déjà été reconnu par penalite_retard');

    const [[entry]] = await pool.query('SELECT narration FROM gl_entries WHERE id = :id', { id: settled.entryId });
    assert.equal(entry.narration, 'Pénalité de retard réglée — Locataire Test');
  } finally {
    conn.release();
  }
});

test('listPortfolioArrears — une pénalité de retard réduit à 0 après règlement intégral, partielle sinon', async () => {
  const lateFeeId = await insertLateFee(12000, '2026-08-01');

  const before1 = await listPortfolioArrears(fx.tenantId);
  const withFee = before1.find((r) => r.leaseId === fx.leaseId);
  assert.ok(withFee, 'le bail doit apparaître même si ce n\'est QUE la pénalité qui est due');
  assert.equal(withFee.lateFeesRemaining, 12000);

  await pool.query(
    `INSERT INTO late_fee_payments (tenant_id, late_fee_id, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :lf, 5000, 'especes', '2026-08-10', :by)`,
    { t: fx.tenantId, lf: lateFeeId, by: fx.dgId },
  );
  const afterPartial = await listPortfolioArrears(fx.tenantId);
  const partial = afterPartial.find((r) => r.leaseId === fx.leaseId);
  assert.equal(partial.lateFeesRemaining, 7000, '12000 appliqués - 5000 réglés');

  await pool.query(
    `INSERT INTO late_fee_payments (tenant_id, late_fee_id, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :lf, 7000, 'especes', '2026-08-11', :by)`,
    { t: fx.tenantId, lf: lateFeeId, by: fx.dgId },
  );
  const afterFull = await listPortfolioArrears(fx.tenantId);
  const full = afterFull.find((r) => r.leaseId === fx.leaseId);
  // Intégralement réglée ET aucun autre motif de retard : le bail ne doit plus apparaître QUE pour ça
  // (peut réapparaître pour du loyer en retard réel accumulé par la fixture, indépendant d'ici).
  assert.equal(full ? full.lateFeesRemaining : 0, 0);
});

test("rattrapage GL (backfill) — application ET règlement d'une pénalité génèrent chacun leur écriture, sur deux tables réelles distinctes", async () => {
  const lateFeeId = await insertLateFee(6000, '2026-01-10');
  await pool.query(
    `INSERT INTO late_fee_payments (tenant_id, late_fee_id, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :lf, 6000, 'virement', '2026-02-05', :by)`,
    { t: fx.tenantId, lf: lateFeeId, by: fx.dgId },
  );

  const summary = await backfillHistoricalEntries(pool, fx.tenantId, { fromDate: '2026-01-01', createdBy: fx.dgId });
  assert.equal(summary.errors.length, 0, JSON.stringify(summary.errors));
  assert.equal(summary.generated, 2);

  const [entries] = await pool.query(
    "SELECT source_operation_type, source_table FROM gl_entries WHERE tenant_id = :t AND source_table IN ('late_fees','late_fee_payments') ORDER BY source_operation_type",
    { t: fx.tenantId },
  );
  assert.deepEqual(entries, [
    { source_operation_type: 'penalite_retard', source_table: 'late_fees' },
    { source_operation_type: 'penalite_retard_encaissee', source_table: 'late_fee_payments' },
  ]);

  // Idempotent : rejouer ne duplique rien.
  const again = await backfillHistoricalEntries(pool, fx.tenantId, { fromDate: '2026-01-01', createdBy: fx.dgId });
  assert.equal(again.generated, 0);
});
