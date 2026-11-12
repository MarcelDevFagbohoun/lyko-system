'use strict';

/**
 * « Maintenant sur les quittances les impayés doivent apparaître jusqu'au paiement définitif »
 * (demande utilisateur, 2026-11-12, juste après la fonctionnalité de détail des impayés à l'entrée
 * par type + mois — migration 151). Vérifie :
 *  - `getOpeningDebtReceiptSummary` (services/leasePayments.js) : `null` dès que le solde est à zéro,
 *    sinon le détail par poste encore dû (ou une ligne globale pour un bail sans détail) ;
 *  - `openingDebtExtraRows` (services/pdf.js) : traduit ce résumé en tableau pour la quittance ;
 *  - bout en bout : la quittance de loyer reste générable (200) qu'il y ait ou non un impayé à
 *    rappeler — pas d'assertion sur le texte du PDF (police custom, voir `paidStampToggle.test.js`).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const leasePayments = require('../src/services/leasePayments');
const { openingDebtExtraRows } = require('../src/services/pdf');

let fx; let server; let base; let paymentId;
const hdr = (userId, role) => ({ Authorization: `Bearer ${signAccessToken({ sub: userId, tenantId: fx.tenantId, role })}` });

before(async () => {
  fx = await createFixture();
  const [pay] = await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-11', '2026-11-01', 50000, 'especes', '2026-11-01', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  paymentId = pay.insertId;
  await pool.query(
    "INSERT INTO receipts (tenant_id, payment_id, receipt_number, issued_at) VALUES (:t, :p, 'QT-OD-001', NOW())",
    { t: fx.tenantId, p: paymentId },
  );

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM receipts WHERE payment_id = :id', { id: paymentId });
  await pool.query('DELETE FROM rent_payments WHERE id = :id', { id: paymentId });
  await teardown(fx.tenantId);
  await closePool();
});

test('aucun impayé déclaré : résumé null, rien sur la quittance', async () => {
  const [[lease]] = await pool.query('SELECT * FROM leases WHERE id = :id', { id: fx.leaseId });
  const summary = await leasePayments.getOpeningDebtReceiptSummary(fx.tenantId, lease);
  assert.equal(summary, null);
  assert.equal(openingDebtExtraRows(summary), null);

  const pdf = await fetch(`${base}/api/leases/${fx.leaseId}/payments/${paymentId}/receipt.pdf`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(pdf.status, 200);
});

test('impayé global (sans détail par poste) : reste affiché tant qu\'il n\'est pas réglé, disparaît une fois soldé', async () => {
  await pool.query('UPDATE leases SET opening_debt_amount = 30000 WHERE id = :id', { id: fx.leaseId });

  const [[lease1]] = await pool.query('SELECT * FROM leases WHERE id = :id', { id: fx.leaseId });
  const summary1 = await leasePayments.getOpeningDebtReceiptSummary(fx.tenantId, lease1);
  assert.equal(summary1.remaining, 30000);
  assert.equal(summary1.items.length, 0);
  const rows1 = openingDebtExtraRows(summary1);
  assert.equal(rows1.rows.length, 1);
  assert.match(rows1.rows[0][0], /Impayés déclarés à l'entrée/);

  // La quittance générère toujours sans erreur avec ce rappel dessus.
  const pdf1 = await fetch(`${base}/api/leases/${fx.leaseId}/payments/${paymentId}/receipt.pdf`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(pdf1.status, 200);

  // Réglé intégralement : « jusqu'au paiement définitif » — après ça, plus rien à rappeler.
  await leasePayments.payOpeningDebt(fx.tenantId, fx.dgId, fx.leaseId, null, {
    amount: 30000,
    paymentMethod: 'especes',
    paidAt: '2026-11-05',
  });
  const [[lease2]] = await pool.query('SELECT * FROM leases WHERE id = :id', { id: fx.leaseId });
  const summary2 = await leasePayments.getOpeningDebtReceiptSummary(fx.tenantId, lease2);
  assert.equal(summary2, null);

  const pdf2 = await fetch(`${base}/api/leases/${fx.leaseId}/payments/${paymentId}/receipt.pdf`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(pdf2.status, 200);

  // Remis dans l'état initial pour ne pas fausser le calcul du solde du test suivant (même bail).
  await pool.query('DELETE FROM lease_opening_debt_payments WHERE lease_id = :id', { id: fx.leaseId });
  await pool.query('UPDATE leases SET opening_debt_amount = 0 WHERE id = :id', { id: fx.leaseId });
});

test('détail par poste (type + mois) : seuls les postes encore dus apparaissent, triés, en colonne rouge', async () => {
  const [item1] = await pool.query(
    `INSERT INTO lease_opening_debt_items (tenant_id, lease_id, debt_type, period_month, amount, created_by)
     VALUES (:t, :l, 'loyer', '2026-09', 50000, :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  const [item2] = await pool.query(
    `INSERT INTO lease_opening_debt_items (tenant_id, lease_id, debt_type, period_month, label, amount, created_by)
     VALUES (:t, :l, 'sbee', '2026-10', 'Facture en retard', 15000, :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  await pool.query('UPDATE leases SET opening_debt_amount = 65000 WHERE id = :id', { id: fx.leaseId });

  // Solde le poste SBEE complètement : il ne doit plus apparaître, le loyer reste.
  await leasePayments.payOpeningDebtItem(fx.tenantId, fx.dgId, fx.leaseId, item2.insertId, null, {
    amount: 15000,
    paymentMethod: 'especes',
    paidAt: '2026-11-05',
  });

  const [[lease]] = await pool.query('SELECT * FROM leases WHERE id = :id', { id: fx.leaseId });
  const summary = await leasePayments.getOpeningDebtReceiptSummary(fx.tenantId, lease);
  assert.equal(summary.remaining, 50000);
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0].debtType, 'loyer');
  assert.equal(summary.items[0].remaining, 50000);

  const rows = openingDebtExtraRows(summary);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.columns[2].color, require('../src/services/pdfDesign').C.DANGER);
  assert.match(rows.rows[0][0], /Loyer/);
  assert.match(rows.rows[0][1], /septembre 2026/);

  const pdf = await fetch(`${base}/api/leases/${fx.leaseId}/payments/${paymentId}/receipt.pdf`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(pdf.status, 200);

  // Nettoyage (ce test modifie des tables que `teardown()` connaît déjà — mais le poste réglé reste
  // sinon une trace orpheline inutile pour le test suivant de ce fichier, s'il y en avait un).
  await pool.query('DELETE FROM lease_opening_debt_item_payments WHERE item_id IN (:i1, :i2)', { i1: item1.insertId, i2: item2.insertId });
  await pool.query('DELETE FROM lease_opening_debt_items WHERE id IN (:i1, :i2)', { i1: item1.insertId, i2: item2.insertId });
});
