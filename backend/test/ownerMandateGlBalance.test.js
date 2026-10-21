'use strict';

/**
 * Audit comptabilité avancée (2026-10-18) : un propriétaire ne doit jamais pouvoir être archivé
 * (`POST /:id/end-mandate`) avec un solde tiers non nul en comptabilité SYSCOHADA (ex. une caution
 * encore enregistrée sous le compte 165 qui lui est propre), même s'il n'a plus aucun Bien rattaché
 * aujourd'hui — voir `routes/owners.js`. Fixture SÉPARÉE de `ownerMandate.test.js` (module GL actif
 * ici, jamais dans l'autre fichier) pour ne jamais faire interférer les deux.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { genererEcriture } = require('../src/services/gl/glPostingService');
const { createFixture, setCommissionRate, teardown } = require('./gl/fixtures');

let fx;
let server;
let baseUrl;

before(async () => {
  fx = await createFixture();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
  'Content-Type': 'application/json',
});

test('POST /:id/end-mandate — refusé si le propriétaire a encore un solde tiers non nul en comptabilité avancée, même sans Bien rattaché', async () => {
  // Loyer encaissé pour le compte du propriétaire (part nette créditée sur SON compte tiers,
  // `tiers_proprietaire` — voir glAccountResolver.js, 'TIERS_PROPRIETAIRE') — jamais reversé dans ce
  // test, donc son compte tiers reste avec un solde créditeur (le cabinet lui doit cette somme).
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10);
  await genererEcriture(pool, {
    tenantId: fx.tenantId,
    operationType: 'loyer_encaisse',
    entryDate: '2026-02-01',
    amount: 100000,
    paymentMethod: 'especes',
    narrationVars: { mois: '2026-02', locataire: 'Locataire Test' },
    sourceTable: 'rent_payments',
    sourceId: 1,
    createdBy: fx.dgId,
    context: { leaseId: fx.leaseId },
  });

  // Plus aucun Bien rattaché à ce propriétaire — satisfait la PREMIÈRE condition (voir
  // ownerMandate.test.js), pour isoler la nouvelle vérification GL de celle-ci.
  const [dummyOwner] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Autre Propriétaire (reprend le Bien)',
    by: fx.dgId,
  });
  await pool.query('UPDATE properties SET owner_id = :newOwnerId WHERE id = :propertyId', {
    newOwnerId: dummyOwner.insertId,
    propertyId: fx.propertyId,
  });

  const res = await fetch(`${baseUrl}/api/owners/${fx.ownerId}/end-mandate`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ reason: 'Fin de la relation commerciale' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /solde non nul en comptabilité avancée/);

  const [rows] = await pool.query('SELECT mandate_ended_at FROM owners WHERE id = :id', { id: fx.ownerId });
  assert.equal(rows[0].mandate_ended_at, null, 'ne doit rien avoir changé en base');

  await pool.query('DELETE FROM owners WHERE id = :id', { id: dummyOwner.insertId });
});

test('POST /:id/end-mandate — un propriétaire sans Bien et sans AUCUNE écriture GL (jamais rien posté) n’est jamais bloqué par cette vérification', async () => {
  const [owner] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Propriétaire Jamais Utilisé',
    by: fx.dgId,
  });

  const res = await fetch(`${baseUrl}/api/owners/${owner.insertId}/end-mandate`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ reason: 'Jamais eu de Bien ni de mouvement' }),
  });
  assert.equal(res.status, 200);
});
