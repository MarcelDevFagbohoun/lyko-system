'use strict';

/**
 * Audit comptable du 23/09/2026, anomalie A3 : un paiement de loyer annulé
 * (suppression logique, `rent_payments.deleted_at`) doit disparaître de
 * TOUS les calculs qui s'appuient sur les paiements réels — arriérés
 * (`listPortfolioArrears`), recette nette d'un Bien (`getRecetteNetteMaison`)
 * et solde séquestre (`getEscrowBalances`) — jamais seulement de la liste
 * affichée à l'écran. Avant ce correctif, aucune fonctionnalité n'existait
 * même pour annuler un paiement (voir routes/leases.js `DELETE
 * /:leaseId/payments/:paymentId`).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { listPortfolioArrears } = require('../../src/services/rentTracking');
const { getRecetteNetteMaison, getEscrowBalances } = require('../../src/services/commission');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test("annulation d'un paiement de loyer — l'échéance qu'il avait réglée redevient due dans listPortfolioArrears", async () => {
  const before1 = await listPortfolioArrears(fx.tenantId);
  const baseline = before1.find((r) => r.leaseId === fx.leaseId);
  assert.ok(baseline, "le bail de la fixture n'a encore aucun paiement : doit déjà apparaître en retard");
  assert.equal(baseline.status ?? 'late', 'late'); // présence dans la liste == en retard (ou dette initiale)

  const currentMonth = new Date().toISOString().slice(0, 7);
  const [result] = await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, :m, 50000, 'especes', :paidAt, :by)`,
    { t: fx.tenantId, l: fx.leaseId, m: currentMonth, paidAt: `${currentMonth}-01`, by: fx.dgId },
  );
  const paymentId = result.insertId;

  const afterPaid = await listPortfolioArrears(fx.tenantId);
  assert.equal(
    afterPaid.some((r) => r.leaseId === fx.leaseId),
    false,
    'une fois le mois courant réglé intégralement, le bail ne doit plus apparaître dans les impayés',
  );

  // Annulation (suppression logique) — exactement ce que fait la route DELETE.
  await pool.query('UPDATE rent_payments SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :r WHERE id = :id', {
    by: fx.dgId,
    r: 'Test audit - annulation',
    id: paymentId,
  });

  const afterCancel = await listPortfolioArrears(fx.tenantId);
  const reinstated = afterCancel.find((r) => r.leaseId === fx.leaseId);
  assert.ok(reinstated, "le paiement annulé ne doit plus compter : l'échéance doit redevenir due");

  await pool.query('DELETE FROM rent_payments WHERE id = :id', { id: paymentId });
});

test("annulation d'un paiement de loyer — exclu de la recette nette et du solde séquestre du propriétaire", async () => {
  const [result] = await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-04', 50000, 'especes', '2026-04-05', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  const paymentId = result.insertId;

  const recetteAvant = await getRecetteNetteMaison(fx.tenantId, fx.propertyId, '2026-04');
  assert.equal(recetteAvant.totalPayments, 50000);
  const escrowAvant = await getEscrowBalances(fx.tenantId);
  const balanceAvant = escrowAvant.get(fx.ownerId)?.totalCollected ?? 0;
  assert.ok(balanceAvant >= 50000, 'le solde séquestre doit refléter ce paiement avant annulation');

  await pool.query('UPDATE rent_payments SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :r WHERE id = :id', {
    by: fx.dgId,
    r: 'Test audit - annulation',
    id: paymentId,
  });

  const recetteApres = await getRecetteNetteMaison(fx.tenantId, fx.propertyId, '2026-04');
  assert.equal(recetteApres.totalPayments, 0, 'un paiement annulé ne doit plus jamais compter dans la recette nette');
  const escrowApres = await getEscrowBalances(fx.tenantId);
  const balanceApres = escrowApres.get(fx.ownerId)?.totalCollected ?? 0;
  assert.equal(balanceApres, balanceAvant - 50000, 'le solde séquestre doit refléter exactement la baisse');

  await pool.query('DELETE FROM rent_payments WHERE id = :id', { id: paymentId });
});
