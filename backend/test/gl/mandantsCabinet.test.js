'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { computeMandantsCabinetIndicator } = require('../../src/services/gl/glMandantsCabinetService');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('trésorerie suffisante : couvre largement les fonds détenus pour le compte de tiers', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Loyer encaissé par virement, aucune commission définie (0 %) : le
    // propriétaire est créditeur de la totalité, 100000 -> 521 et -> 4671.
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'loyer_encaisse',
      entryDate: '2026-01-05',
      amount: 100000,
      paymentMethod: 'virement',
      narrationVars: { mois: '2026-01', locataire: 'Locataire Test' },
      sourceTable: 'rent_payments',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    // Caution reçue en espèces : 50000 -> 571 et -> 165.
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'caution_recue',
      entryDate: '2026-01-06',
      amount: 50000,
      paymentMethod: 'especes',
      narrationVars: { locataire: 'Locataire Test' },
      sourceTable: 'leases',
      sourceId: fx.leaseId,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();
  } finally {
    conn.release();
  }

  const result = await computeMandantsCabinetIndicator(pool, fx.tenantId);
  assert.equal(result.treasury.banque, 100000);
  assert.equal(result.treasury.caisse, 50000);
  assert.equal(result.treasury.total, 150000);
  assert.equal(result.dueToOwners, 100000);
  assert.equal(result.depositsHeld, 50000);
  assert.equal(result.fundsHeldForThirdParties, 150000);
  assert.equal(result.coverage, 0, 'trésorerie exactement égale aux fonds de tiers ici : rien encore dépensé');
});

test('trésorerie insuffisante après une dépense payée avec de la trésorerie qui ne devrait pas y toucher', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Le cabinet dépense 40000 de sa caisse pour son propre fonctionnement —
    // légitime en soi, mais fait passer la trésorerie SOUS les fonds de
    // tiers déjà détenus (150000), signalant qu'il a dû puiser dedans.
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'depense_fournitures',
      entryDate: '2026-01-20',
      amount: 40000,
      paymentMethod: 'especes',
      narrationVars: { libelle: 'Fournitures bureau' },
      sourceTable: 'expenses',
      sourceId: 1,
      createdBy: fx.dgId,
    });
    await conn.commit();
  } finally {
    conn.release();
  }

  const result = await computeMandantsCabinetIndicator(pool, fx.tenantId);
  assert.equal(result.treasury.total, 110000, '150000 − 40000');
  assert.equal(result.fundsHeldForThirdParties, 150000, 'inchangé : aucun reversement, aucune restitution');
  assert.equal(result.coverage, -40000, 'trésorerie désormais insuffisante pour couvrir les fonds de tiers');
});

test('un reversement au propriétaire réduit les fonds de tiers ET la trésorerie à parts égales — la couverture ne bouge pas pour cette part', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'reversement_proprietaire',
      entryDate: '2026-01-25',
      amount: 60000,
      paymentMethod: 'virement',
      narrationVars: { proprietaire: 'Propriétaire Test' },
      sourceTable: 'owner_payouts',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { ownerId: fx.ownerId },
    });
    await conn.commit();
  } finally {
    conn.release();
  }

  const result = await computeMandantsCabinetIndicator(pool, fx.tenantId);
  assert.equal(result.dueToOwners, 40000, '100000 − 60000 reversé');
  assert.equal(result.treasury.total, 50000, '110000 − 60000 sorti par virement');
  assert.equal(result.fundsHeldForThirdParties, 90000, '40000 dû aux propriétaires + 50000 de caution');
  assert.equal(result.coverage, -40000, "l'insuffisance déjà présente (creusée par la dépense) reste, le reversement ne la corrige pas");
});
