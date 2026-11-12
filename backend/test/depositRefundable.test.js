'use strict';

/**
 * Caution remboursable ou non (demande utilisateur, 2026-11-12) : l'agent choisit, pour la caution
 * principale (`leases.deposit_refundable`) ET chaque caution supplémentaire (`lease_deposits.refundable`),
 * si elle sera un jour rendue. Une caution NON remboursable n'entre JAMAIS dans le décompte de sortie —
 * acquise au propriétaire d'office, quel que soit l'état du logement. Voir `moveOutReport.js`
 * `startMoveOutReport` (caution principale) et `leaseDeposits.js` `checkAdditionalDepositRefunds`
 * (cautions supplémentaires).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { startMoveOutReport } = require('../src/services/moveOutReport');
const { checkAdditionalDepositRefunds, listLeaseDeposits } = require('../src/services/leaseDeposits');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('startMoveOutReport — caution de loyer NON remboursable : montant figé à 0 sur la fiche de sortie', async () => {
  await pool.query(
    "UPDATE leases SET deposit_refundable = 0, deposit_amount = 50000, status = 'active' WHERE id = :id",
    { id: fx.leaseId },
  );
  const row = await startMoveOutReport(fx.tenantId, fx.dgId, fx.leaseId, null, '2026-02-01');
  assert.equal(Number(row.deposit_amount), 0);
  assert.equal(Number(row.net_refund), 0);
  await pool.query('DELETE FROM move_out_reports WHERE lease_id = :id', { id: fx.leaseId });
});

test("startMoveOutReport — caution de loyer remboursable (comportement par défaut, inchangé) : montant transmis intégralement", async () => {
  await pool.query(
    "UPDATE leases SET deposit_refundable = 1, deposit_amount = 50000, status = 'active' WHERE id = :id",
    { id: fx.leaseId },
  );
  const row = await startMoveOutReport(fx.tenantId, fx.dgId, fx.leaseId, null, '2026-02-01');
  assert.equal(Number(row.deposit_amount), 50000);
  assert.equal(Number(row.net_refund), 50000);
  await pool.query('DELETE FROM move_out_reports WHERE lease_id = :id', { id: fx.leaseId });
  await pool.query("UPDATE leases SET status = 'active' WHERE id = :id", { id: fx.leaseId });
});

test('checkAdditionalDepositRefunds — une caution SBEE NON remboursable est exclue du décompte de sortie, et reste "held"', async () => {
  const [sbee] = await pool.query(
    `INSERT INTO lease_deposits (tenant_id, lease_id, type, amount, refundable, status, received_at, received_method, created_by)
     VALUES (:t, :l, 'sbee', 10000, 0, 'held', '2026-01-01', 'especes', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  const [soneb] = await pool.query(
    `INSERT INTO lease_deposits (tenant_id, lease_id, type, amount, refundable, status, received_at, received_method, created_by)
     VALUES (:t, :l, 'soneb', 8000, 1, 'held', '2026-01-01', 'especes', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );

  const { rows } = await checkAdditionalDepositRefunds(pool, {
    tenantId: fx.tenantId,
    leaseId: fx.leaseId,
    refundMethods: { soneb: 'especes' },
  });
  // Seule la caution SONEB (remboursable) apparaît — la SBEE non remboursable est invisible ici.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'soneb');

  const deposits = await listLeaseDeposits(fx.tenantId, fx.leaseId);
  const sbeeDeposit = deposits.find((d) => d.type === 'sbee');
  assert.equal(sbeeDeposit.refundable, false);
  assert.equal(sbeeDeposit.status, 'held');

  await pool.query('DELETE FROM lease_deposits WHERE id IN (:a, :b)', { a: sbee.insertId, b: soneb.insertId });
});
