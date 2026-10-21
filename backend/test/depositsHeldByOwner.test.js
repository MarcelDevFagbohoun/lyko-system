'use strict';

/**
 * Cautions actuellement détenues par propriétaire (demande utilisateur, 2026-10-17) : affichées à
 * côté de la recette nette cumulée (`getEscrowBalances`), jamais fondues dedans — une caution n'est
 * pas un revenu. Voir `services/commission.js` `getDepositsHeldByOwner`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { getDepositsHeldByOwner } = require('../src/services/commission');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('getDepositsHeldByOwner — un montant seulement DÉCLARÉ (deposit_amount), jamais marqué reçu, ne compte pas', async () => {
  // `createBareFixture` crée le bail avec deposit_amount=50000 mais deposit_received_at NULL.
  const held = await getDepositsHeldByOwner(fx.tenantId, fx.ownerId);
  assert.equal(held.total, 0);
  assert.equal(held.breakdown.depositLoyer, 0);
});

test('getDepositsHeldByOwner — caution de loyer réellement reçue et toujours détenue', async () => {
  await pool.query(
    "UPDATE leases SET deposit_received_at = '2026-01-01', deposit_received_method = 'especes' WHERE id = :id",
    { id: fx.leaseId },
  );
  const held = await getDepositsHeldByOwner(fx.tenantId, fx.ownerId);
  assert.equal(held.total, 50000);
  assert.deepEqual(held.breakdown, { depositLoyer: 50000, sbee: 0, soneb: 0, peinture: 0 });
});

test('getDepositsHeldByOwner — une caution de loyer déjà RESTITUÉE ne compte plus', async () => {
  await pool.query("UPDATE leases SET deposit_status = 'returned' WHERE id = :id", { id: fx.leaseId });
  const held = await getDepositsHeldByOwner(fx.tenantId, fx.ownerId);
  assert.equal(held.total, 0);
  // Remet en l'état pour les tests suivants.
  await pool.query("UPDATE leases SET deposit_status = 'held' WHERE id = :id", { id: fx.leaseId });
});

test('getDepositsHeldByOwner — cautions supplémentaires (SBEE/SONEB/peinture) détenues, groupées par type', async () => {
  await pool.query(
    `INSERT INTO lease_deposits (tenant_id, lease_id, type, amount, status, received_at, received_method, created_by)
     VALUES (:t, :l, 'sbee', 10000, 'held', '2026-01-01', 'especes', :by),
            (:t, :l, 'soneb', 8000, 'held', '2026-01-01', 'especes', :by),
            (:t, :l, 'peinture', 20000, 'returned', '2026-01-01', 'especes', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  const held = await getDepositsHeldByOwner(fx.tenantId, fx.ownerId);
  // Caution de loyer (50000, toujours détenue depuis le test précédent) + SBEE (10000) + SONEB (8000).
  // Peinture exclue (déjà restituée) — même principe que la caution de loyer restituée ci-dessus.
  assert.equal(held.total, 50000 + 10000 + 8000);
  assert.deepEqual(held.breakdown, { depositLoyer: 50000, sbee: 10000, soneb: 8000, peinture: 0 });
});

test("getDepositsHeldByOwner — scopé par propriétaire : la caution d'un AUTRE propriétaire n'apparaît jamais", async () => {
  const [otherOwner] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Autre Propriétaire',
    by: fx.dgId,
  });
  const held = await getDepositsHeldByOwner(fx.tenantId, otherOwner.insertId);
  assert.equal(held.total, 0);
  await pool.query('DELETE FROM owners WHERE id = :o', { o: otherOwner.insertId });
});
