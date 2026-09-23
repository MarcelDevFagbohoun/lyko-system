'use strict';

/**
 * Audit comptable du 23/09/2026, anomalie B1 : chaque erreur métier
 * anticipée du moteur GL doit porter un vrai code HTTP (`ApiError`), jamais
 * une `Error` générique — sans ça, `middleware/error.js` renvoie toujours
 * 500 et, en production, REMPLACE le message (pourtant déjà écrit et utile)
 * par un texte générique, laissant l'utilisateur sans aucune indication.
 * Ce fichier vérifie que chaque cas anticipé et actionnable par l'utilisateur
 * lève bien une `ApiError` avec le bon statut — pas les invariants internes
 * ("ceci ne devrait jamais arriver", volontairement laissés en 500).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { ApiError } = require('../../src/middleware/error');
const { genererEcriture, resolveOpenFiscalYear } = require('../../src/services/gl/glPostingService');
const {
  resolveRenterFromLease,
  resolveOwnerFromLease,
  resolveSupplierThirdParty,
  resolveLineAccount,
} = require('../../src/services/gl/glAccountResolver');
const { GL_ACCOUNT_ROLES } = require('../../src/constants/glAccountRoles');
const { getOrCreateThirdParty } = require('../../src/services/gl/glThirdPartyService');
const { cloturerExercice } = require('../../src/services/gl/glClosingService');
const { extourneEcriture } = require('../../src/services/gl/glReversalService');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

function assertApiError(status) {
  return (err) => err instanceof ApiError && err.status === status;
}

test('resolveOpenFiscalYear — aucun exercice ne couvre la date -> 404', async () => {
  const conn = await pool.getConnection();
  try {
    await assert.rejects(() => resolveOpenFiscalYear(conn, fx.tenantId, '2099-01-01'), assertApiError(404));
  } finally {
    conn.release();
  }
});

test('resolveOpenFiscalYear — exercice clôturé -> 409', async () => {
  await pool.query("UPDATE gl_fiscal_years SET status = 'cloture' WHERE id = :id", { id: fx.fiscalYearId });
  const conn = await pool.getConnection();
  try {
    await assert.rejects(() => resolveOpenFiscalYear(conn, fx.tenantId, '2026-06-15'), assertApiError(409));
  } finally {
    conn.release();
    await pool.query("UPDATE gl_fiscal_years SET status = 'ouvert' WHERE id = :id", { id: fx.fiscalYearId });
  }
});

test('genererEcriture — aucune règle active pour ce type d\'opération -> 404', async () => {
  await pool.query("UPDATE gl_posting_rules SET is_active = 0 WHERE tenant_id = :t AND operation_type = 'loyer_encaisse'", { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assert.rejects(
      () =>
        genererEcriture(conn, {
          tenantId: fx.tenantId,
          operationType: 'loyer_encaisse',
          entryDate: '2026-06-01',
          amount: 10000,
          paymentMethod: 'especes',
          narrationVars: {},
          createdBy: fx.dgId,
          context: { leaseId: fx.leaseId },
        }),
      assertApiError(404),
    );
    await conn.rollback();
  } finally {
    conn.release();
    await pool.query("UPDATE gl_posting_rules SET is_active = 1 WHERE tenant_id = :t AND operation_type = 'loyer_encaisse'", { t: fx.tenantId });
  }
});

test('resolveRenterFromLease / resolveOwnerFromLease — bail inexistant -> 404', async () => {
  const conn = await pool.getConnection();
  try {
    await assert.rejects(() => resolveRenterFromLease(conn, fx.tenantId, 999999999), assertApiError(404));
    await assert.rejects(() => resolveOwnerFromLease(conn, fx.tenantId, 999999999), assertApiError(404));
  } finally {
    conn.release();
  }
});

test('resolveSupplierThirdParty — fournisseur inexistant -> 404', async () => {
  const conn = await pool.getConnection();
  try {
    await assert.rejects(() => resolveSupplierThirdParty(conn, fx.tenantId, 999999999), assertApiError(404));
  } finally {
    conn.release();
  }
});

test('resolveLineAccount (TRESORERIE_MODE_PAIEMENT) — mode de paiement non pris en charge -> 400', async () => {
  const conn = await pool.getConnection();
  try {
    await assert.rejects(
      () =>
        resolveLineAccount(conn, {
          tenantId: fx.tenantId,
          line: { account_role: GL_ACCOUNT_ROLES.TRESORERIE_MODE_PAIEMENT },
          context: { paymentMethod: 'bitcoin' },
        }),
      assertApiError(400),
    );
  } finally {
    conn.release();
  }
});

test('resolveLineAccount (TIERS_PROPRIETAIRE) — propriétaire inexistant -> 404', async () => {
  const conn = await pool.getConnection();
  try {
    await assert.rejects(
      () =>
        resolveLineAccount(conn, {
          tenantId: fx.tenantId,
          line: { account_role: GL_ACCOUNT_ROLES.TIERS_PROPRIETAIRE },
          context: { ownerId: 999999999 },
        }),
      assertApiError(404),
    );
  } finally {
    conn.release();
  }
});

test('getOrCreateThirdParty — compte collectif introuvable (system_key manquant) -> 404', async () => {
  await pool.query("UPDATE gl_accounts SET system_key = NULL WHERE tenant_id = :t AND system_key = 'owner_control_account'", { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await assert.rejects(
      () =>
        getOrCreateThirdParty(conn, {
          tenantId: fx.tenantId,
          partyType: 'owner',
          sourceTable: 'owners',
          sourceId: fx.ownerId,
          displayName: 'Test',
        }),
      assertApiError(404),
    );
  } finally {
    conn.release();
    await pool.query("UPDATE gl_accounts SET system_key = 'owner_control_account' WHERE tenant_id = :t AND code = '4671'", { t: fx.tenantId });
  }
});

test('cloturerExercice — exercice inexistant -> 404, déjà clôturé -> 409', async () => {
  const conn = await pool.getConnection();
  try {
    await assert.rejects(() => cloturerExercice(conn, { tenantId: fx.tenantId, fiscalYearId: 999999999, userId: fx.dgId }), assertApiError(404));
  } finally {
    conn.release();
  }

  await pool.query("UPDATE gl_fiscal_years SET status = 'cloture' WHERE id = :id", { id: fx.fiscalYearId });
  const conn2 = await pool.getConnection();
  try {
    await assert.rejects(() => cloturerExercice(conn2, { tenantId: fx.tenantId, fiscalYearId: fx.fiscalYearId, userId: fx.dgId }), assertApiError(409));
  } finally {
    conn2.release();
    await pool.query("UPDATE gl_fiscal_years SET status = 'ouvert' WHERE id = :id", { id: fx.fiscalYearId });
  }
});

test('extourneEcriture — écriture inexistante -> 404, déjà extournée -> 409', async () => {
  const conn = await pool.getConnection();
  try {
    await assert.rejects(
      () => extourneEcriture(conn, { tenantId: fx.tenantId, entryId: 999999999, entryDate: '2026-06-01', userId: fx.dgId, reason: 'test' }),
      assertApiError(404),
    );
  } finally {
    conn.release();
  }

  // Génère une vraie écriture, l'extourne, puis vérifie que la ré-extourner échoue en 409.
  const conn2 = await pool.getConnection();
  let entryId;
  try {
    await conn2.beginTransaction();
    const result = await genererEcriture(conn2, {
      tenantId: fx.tenantId,
      operationType: 'loyer_encaisse',
      entryDate: '2026-06-02',
      amount: 20000,
      paymentMethod: 'especes',
      narrationVars: { mois: '2026-06', locataire: 'Test' },
      sourceTable: 'rent_payments',
      sourceId: 999999,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    entryId = result.entryId;
    await conn2.commit();
  } finally {
    conn2.release();
  }

  const conn3 = await pool.getConnection();
  try {
    await conn3.beginTransaction();
    await extourneEcriture(conn3, { tenantId: fx.tenantId, entryId, entryDate: '2026-06-03', userId: fx.dgId, reason: 'test' });
    await conn3.commit();
  } finally {
    conn3.release();
  }

  const conn4 = await pool.getConnection();
  try {
    await assert.rejects(
      () => extourneEcriture(conn4, { tenantId: fx.tenantId, entryId, entryDate: '2026-06-04', userId: fx.dgId, reason: 'double' }),
      assertApiError(409),
    );
  } finally {
    conn4.release();
  }
});
