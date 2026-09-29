'use strict';

/**
 * Contrat de bail (étape 46, demande directe de l'utilisateur : « attestation loyer doit être changé
 * en contrat de loyer ») — remplace l'ancienne attestation (lettre unilatérale à texte libre). Document
 * structuré par articles, calculés depuis les données RÉELLES du bail (voir `services/leaseContract.js`
 * `buildContractData`), jamais saisis à la main (seules les conditions particulières le sont).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { buildContractData, loadContractRow, toPublicContract } = require('../src/services/leaseContract');
const { createFixture, teardown } = require('./gl/fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('buildContractData — reprend les données réelles du bail/bien/propriétaire/locataire, jamais saisies à la main', async () => {
  const data = await buildContractData(fx.tenantId, fx.leaseId);

  assert.equal(data.renter.firstName, 'Locataire');
  assert.equal(data.renter.lastName, 'Test');
  assert.equal(data.owner.name, 'Propriétaire Test');
  assert.equal(data.property.code, 'GLT-001');
  assert.equal(data.unit.code, 'U1');
  assert.equal(data.unit.designationLabel, 'Studio');
  assert.equal(data.lease.monthlyRent, 50000);
  assert.equal(data.lease.startDate, '2026-01-01');
  assert.equal(data.lease.rentTiming, 'avance');
  assert.equal(data.lease.rentTimingLabel, "Payé d'avance (dans le mois facturé)");
  assert.equal(data.lease.depositAmount, 50000);
  assert.equal(data.lease.entryFeeAmount, 0);
  assert.deepEqual(data.additionalDeposits, []);
  assert.equal(data.particularConditions, null);
});

test('buildContractData — inclut les cautions supplémentaires (étape 43) déjà détenues sur ce bail', async () => {
  await pool.query(
    `INSERT INTO lease_deposits (tenant_id, lease_id, type, amount, status, received_at, received_method, created_by)
     VALUES (:t, :l, 'sbee', 15000, 'held', '2026-01-01', 'especes', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );

  const data = await buildContractData(fx.tenantId, fx.leaseId, { particularConditions: 'Animal domestique autorisé.' });
  assert.deepEqual(data.additionalDeposits, [{ type: 'sbee', typeLabel: 'Caution SBEE (électricité)', amount: 15000 }]);
  assert.equal(data.particularConditions, 'Animal domestique autorisé.');

  await pool.query('DELETE FROM lease_deposits WHERE lease_id = :l', { l: fx.leaseId });
});

test("buildContractData — lève une erreur explicite pour un bail introuvable, jamais un plantage silencieux", async () => {
  await assert.rejects(() => buildContractData(fx.tenantId, 999999999), /introuvable/);
});

test('loadContractRow / toPublicContract — null tant que rien n\'est démarré, forme correcte une fois créé', async () => {
  const before1 = await loadContractRow(fx.tenantId, fx.leaseId);
  assert.equal(before1, null);
  assert.equal(toPublicContract(before1), null);

  const [result] = await pool.query(
    "INSERT INTO lease_contracts (tenant_id, lease_id, status, created_by) VALUES (:t, :l, 'draft', :by)",
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  const row = await loadContractRow(fx.tenantId, fx.leaseId);
  const pub = toPublicContract(row);
  assert.equal(pub.status, 'draft');
  assert.equal(pub.particularConditions, null);
  assert.equal(pub.tenantSignatureUrl, null);
  assert.equal(pub.agentSignatureUrl, null);
  assert.equal(pub.createdBy.name, 'DG Test');

  await pool.query('DELETE FROM lease_contracts WHERE id = :id', { id: result.insertId });
});
