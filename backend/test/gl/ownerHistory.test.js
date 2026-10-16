'use strict';

/**
 * Audit comptabilité avancée (2026-10-02), bug confirmé : `resolveOwnerFromLease`
 * (glAccountResolver.js) joignait directement `properties.owner_id` (propriétaire ACTUEL) au lieu de
 * résoudre le propriétaire EN VIGUEUR à la date de l'écriture via `property_owner_history` — alors
 * que `services/commission.js` avait déjà ce correctif pour la comptabilité simple depuis l'étape
 * 51bis. Un Bien réattribué faisait donc imputer, dans le GRAND LIVRE lui-même, tout paiement
 * antérieur au NOUVEAU propriétaire (compte 4671 ET taux de commission).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { createFixture, setCommissionRate, teardown } = require('./fixtures');

let fx;
let ownerBId;

// Réattribution au milieu de l'exercice de test : avant cette date, le Bien appartient au
// propriétaire A (celui de la fixture) ; à partir de cette date, au propriétaire B.
const REASSIGNED_ON = '2026-06-01';

before(async () => {
  fx = await createFixture();

  const [ownerB] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Propriétaire B (nouveau)',
    by: fx.dgId,
  });
  ownerBId = ownerB.insertId;

  // Même geste que `PATCH /api/properties/:id` (routes/properties.js) : clôt la période ouverte du
  // propriétaire A, ouvre celle du propriétaire B — jamais une ligne réécrite.
  await pool.query(
    "UPDATE property_owner_history SET ends_on = :endsOn WHERE property_id = :propertyId AND ends_on IS NULL",
    { endsOn: REASSIGNED_ON, propertyId: fx.propertyId },
  );
  await pool.query(
    'INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on, set_by) VALUES (:t, :p, :o, :startsOn, :by)',
    { t: fx.tenantId, p: fx.propertyId, o: ownerBId, startsOn: REASSIGNED_ON, by: fx.dgId },
  );

  // Taux distincts par propriétaire, pour vérifier que le BON taux suit le BON propriétaire — pas
  // seulement l'identité du tiers.
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10); // Propriétaire A : 10 %
  await pool.query(
    "INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, set_by) VALUES (:t, :o, 20, '2026-01-01', :by)",
    { t: fx.tenantId, o: ownerBId, by: fx.dgId },
  ); // Propriétaire B : 20 %
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

async function ownerIdOfThirdParty(thirdPartyId) {
  const [[row]] = await pool.query('SELECT source_id FROM gl_third_parties WHERE id = :id', { id: thirdPartyId });
  return row.source_id;
}

test('genererEcriture — loyer encaissé AVANT la réattribution : imputé au propriétaire A (ancien), à son taux', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'loyer_encaisse',
      entryDate: '2026-03-05', // avant REASSIGNED_ON
      amount: 50000,
      paymentMethod: 'especes',
      narrationVars: { mois: 'mars 2026', locataire: 'Locataire Test' },
      sourceTable: 'rent_payments',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    const ownerLine = result.lines.find((l) => l.side === 'credit' && l.amount === 45000); // 90 % net (taux A = 10 %)
    const commissionLine = result.lines.find((l) => l.side === 'credit' && l.amount === 5000); // 10 % de 50000
    assert.ok(ownerLine, 'ligne tiers-propriétaire à 45000 (net du taux de A, 10 %) attendue');
    assert.ok(commissionLine, 'ligne commission à 5000 (10 % de A) attendue');
    assert.equal(await ownerIdOfThirdParty(ownerLine.thirdPartyId), fx.ownerId, 'doit être imputé au propriétaire A, EN VIGUEUR en mars 2026');
  } finally {
    conn.release();
  }
});

test('genererEcriture — loyer encaissé APRÈS la réattribution : imputé au propriétaire B (nouveau), à son taux', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'loyer_encaisse',
      entryDate: '2026-07-05', // après REASSIGNED_ON
      amount: 50000,
      paymentMethod: 'especes',
      narrationVars: { mois: 'juillet 2026', locataire: 'Locataire Test' },
      sourceTable: 'rent_payments',
      sourceId: 2,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    const ownerLine = result.lines.find((l) => l.side === 'credit' && l.amount === 40000); // 80 % net (taux B = 20 %)
    const commissionLine = result.lines.find((l) => l.side === 'credit' && l.amount === 10000); // 20 % de 50000
    assert.ok(ownerLine, 'ligne tiers-propriétaire à 40000 (net du taux de B, 20 %) attendue');
    assert.ok(commissionLine, 'ligne commission à 10000 (20 % de B) attendue');
    assert.equal(await ownerIdOfThirdParty(ownerLine.thirdPartyId), ownerBId, 'doit être imputé au propriétaire B, EN VIGUEUR en juillet 2026 — PAS le propriétaire A malgré le même Bien/bail');
  } finally {
    conn.release();
  }
});

test("genererEcriture — rattrapage rétroactif (glActivationService) : une date avant l'activation respecte, elle aussi, le propriétaire EN VIGUEUR à cette date-là", async () => {
  // Même scénario que le 1er test, mais ENCORE PLUS tôt que l'ouverture de l'exercice fiscal —
  // reproduit la situation d'un rattrapage historique où `entryDate` peut être bien antérieure à
  // aujourd'hui : le moteur ne doit JAMAIS retomber sur `properties.owner_id` (actuel = B) juste
  // parce que la date est ancienne.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'loyer_encaisse',
      entryDate: '2026-01-10',
      amount: 50000,
      paymentMethod: 'especes',
      narrationVars: { mois: 'janvier 2026', locataire: 'Locataire Test' },
      sourceTable: 'rent_payments',
      sourceId: 3,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    const ownerLine = result.lines.find((l) => l.side === 'credit' && l.amount === 45000);
    assert.ok(ownerLine);
    assert.equal(await ownerIdOfThirdParty(ownerLine.thirdPartyId), fx.ownerId, 'janvier 2026 est toujours avant la réattribution : propriétaire A');
  } finally {
    conn.release();
  }
});
