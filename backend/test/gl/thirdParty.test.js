'use strict';

/**
 * Bug corrigé (audit comptable, étape 51bis, Moyenne #3) : `getOrCreateThirdParty` faisait un SELECT puis
 * un INSERT sans aucun verrou — deux opérations concernant le MÊME tiers jamais encore vu en comptabilité
 * (ex. deux loyers du même locataire enregistrés au même instant) pouvaient toutes deux passer le SELECT
 * avant que l'une des deux ne commite, et la contrainte UNIQUE `uq_gl_third_parties_source` (migration 046)
 * faisait alors échouer la SECONDE — un paiement par ailleurs valide perdu dans une erreur 500.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { getOrCreateThirdParty } = require('../../src/services/gl/glThirdPartyService');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('getOrCreateThirdParty — appelé deux fois SÉQUENTIELLEMENT pour le même tiers renvoie la même ligne, jamais un doublon', async () => {
  const conn = await pool.getConnection();
  try {
    const first = await getOrCreateThirdParty(conn, {
      tenantId: fx.tenantId,
      partyType: 'renter',
      sourceTable: 'renters',
      sourceId: 999001,
      displayName: 'Locataire Séquentiel',
    });
    const second = await getOrCreateThirdParty(conn, {
      tenantId: fx.tenantId,
      partyType: 'renter',
      sourceTable: 'renters',
      sourceId: 999001,
      displayName: 'Locataire Séquentiel',
    });
    assert.equal(second.id, first.id);
    const [[{ n }]] = await pool.query(
      "SELECT COUNT(*) AS n FROM gl_third_parties WHERE tenant_id = :t AND source_table = 'renters' AND source_id = 999001",
      { t: fx.tenantId },
    );
    assert.equal(Number(n), 1);
  } finally {
    conn.release();
  }
});

test("getOrCreateThirdParty — deux créations en VRAIE concurrence pour le même tiers jamais encore vu ne font jamais échouer l'une des deux", async () => {
  // Deux connexions MySQL distinctes, `Promise.all` : une vraie course, pas un simple enchaînement
  // séquentiel — exactement le scénario visé par l'audit (deux loyers du même locataire enregistrés au
  // même instant par deux employés, ou deux requêtes concurrentes).
  const connA = await pool.getConnection();
  const connB = await pool.getConnection();
  try {
    const [resultA, resultB] = await Promise.all([
      getOrCreateThirdParty(connA, {
        tenantId: fx.tenantId,
        partyType: 'renter',
        sourceTable: 'renters',
        sourceId: 999002,
        displayName: 'Locataire Concurrent',
      }),
      getOrCreateThirdParty(connB, {
        tenantId: fx.tenantId,
        partyType: 'renter',
        sourceTable: 'renters',
        sourceId: 999002,
        displayName: 'Locataire Concurrent',
      }),
    ]);
    assert.equal(resultA.id, resultB.id, 'les deux appels doivent résoudre vers la MÊME ligne, jamais deux lignes distinctes');

    const [[{ n }]] = await pool.query(
      "SELECT COUNT(*) AS n FROM gl_third_parties WHERE tenant_id = :t AND source_table = 'renters' AND source_id = 999002",
      { t: fx.tenantId },
    );
    assert.equal(Number(n), 1, 'une seule ligne au final, jamais un doublon ni une erreur non rattrapée');
  } finally {
    connA.release();
    connB.release();
  }
});

test("getOrCreateThirdParty — un tiers renommé voit son display_name mis à jour au prochain appel, jamais figé à sa première valeur (étape 51bis, Basse #5)", async () => {
  const conn = await pool.getConnection();
  try {
    const first = await getOrCreateThirdParty(conn, {
      tenantId: fx.tenantId,
      partyType: 'renter',
      sourceTable: 'renters',
      sourceId: 999003,
      displayName: 'Ancien Nom',
    });
    assert.equal(first.display_name, 'Ancien Nom');

    const renamed = await getOrCreateThirdParty(conn, {
      tenantId: fx.tenantId,
      partyType: 'renter',
      sourceTable: 'renters',
      sourceId: 999003,
      displayName: 'Nouveau Nom',
    });
    assert.equal(renamed.id, first.id, 'toujours la même ligne, jamais un doublon');
    assert.equal(renamed.display_name, 'Nouveau Nom', 'le nom doit refléter le renommage, jamais rester figé');

    const [[row]] = await pool.query('SELECT display_name FROM gl_third_parties WHERE id = :id', { id: first.id });
    assert.equal(row.display_name, 'Nouveau Nom', 'persisté en base, pas seulement dans la valeur de retour');
  } finally {
    conn.release();
  }
});
