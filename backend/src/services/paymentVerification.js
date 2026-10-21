'use strict';

const { ApiError } = require('../middleware/error');
const { pool } = require('../config/db');
const { recordRentPayment } = require('../routes/leases');
const { recordUtilityPayment, loadCharge } = require('../routes/charges');
const { notifyRentPaymentsRecorded, notifyUtilityPaymentRecorded } = require('./payments/notify');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('./accountingPeriods');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function loadActiveLeaseForPayment(conn, tenantId, leaseId) {
  const [rows] = await conn.query('SELECT * FROM leases WHERE id = :id AND tenant_id = :t LIMIT 1', {
    id: leaseId,
    t: tenantId,
  });
  if (!rows[0]) throw new ApiError(404, 'Bail introuvable');
  if (rows[0].status !== 'active') throw new ApiError(400, 'Ce bail est terminé');
  rows[0].id = leaseId;
  return rows[0];
}

/**
 * Enregistrement commun d'un paiement en ligne DÉJÀ CONFIRMÉ par le prestataire (relu côté serveur par l'appelant).
 * `transactionKey` : identifiant unique de la transaction (clé d'idempotence en base). `amount` : montant CONFIRMÉ
 * par le prestataire, jamais un montant fourni par le client.
 */
async function recordConfirmedOnlinePayment({ tenant, kind, leaseId, chargeId, linkId, transactionKey, amount, paymentMethod }) {
  let rentResult = null;
  let utilityResult = null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Re-vérifie SOUS VERROU, dans la transaction — voir le commentaire détaillé sur
    // `assertPeriodOpenLocked` (même schéma que les routes manuelles de leases.js/charges.js).
    await assertPeriodOpenLocked(conn, tenant.id, todayIso());

    if (kind === 'rent') {
      await conn.query('SELECT id FROM leases WHERE id = :id FOR UPDATE', { id: leaseId });
      const lease = await loadActiveLeaseForPayment(conn, tenant.id, leaseId);
      rentResult = await recordRentPayment(conn, {
        tenantId: tenant.id,
        lease,
        coversMonth: null,
        amount,
        paymentMethod,
        paidAt: todayIso(),
        notes: null,
        recordedBy: null,
        kkiapayTransactionId: transactionKey,
      });
    } else {
      await conn.query('SELECT id FROM utility_charges WHERE id = :id FOR UPDATE', { id: chargeId });
      const charge = await loadCharge(conn, tenant.id, chargeId);
      if (charge.status === 'payee') throw new ApiError(400, 'Cette facture est déjà entièrement réglée');
      utilityResult = await recordUtilityPayment(conn, {
        tenantId: tenant.id,
        charge,
        amount,
        paymentMethod,
        paidAt: todayIso(),
        notes: null,
        recordedBy: null,
        kkiapayTransactionId: transactionKey,
      });
    }

    if (linkId) {
      // Bug corrigé (audit sécurité/logique) : le lien était marqué « payé »
      // pour toute transaction le prestataire de paiement confirmée, sans comparer son montant à
      // celui réellement attendu (`payment_links.amount`) — un montant
      // insuffisant (transaction mal formée, ou une autre transaction réelle
      // du même compte marchand délibérément soumise ici) affichait quand
      // même « réglé » au personnel alors que la dette n'est pas soldée.
      // L'argent reçu est de toute façon déjà crédité ci-dessus au bail/à la
      // facture (jamais refusé) — seul le badge du LIEN reste « en attente »
      // si le montant confirmé n'atteint pas ce qui était demandé, pour que
      // le même lien reste utilisable pour le complément.
      const [[link]] = await conn.query(
        'SELECT amount FROM payment_links WHERE id = :id AND tenant_id = :t FOR UPDATE',
        { id: linkId, t: tenant.id },
      );
      if (link && amount >= Number(link.amount)) {
        await conn.query(
          `UPDATE payment_links SET status = 'paid', paid_at = NOW(), kkiapay_transaction_id = :tx
           WHERE id = :id AND tenant_id = :t`,
          { tx: transactionKey, id: linkId, t: tenant.id },
        );
      }
    }

    await conn.commit();
    // E-mail automatique au locataire (après commit ; ne bloque ni n'échoue jamais le paiement).
    if (rentResult) notifyRentPaymentsRecorded(tenant.id, rentResult.payments.map((p) => p.paymentId));
    if (utilityResult) notifyUtilityPaymentRecorded(tenant.id, utilityResult.paymentId);
    return { alreadyRecorded: false, amount };
  } catch (err) {
    await conn.rollback().catch(() => {});
    // Un retry concurrent (deux livraisons du même webhook en parallèle) peut
    // franchir la vérification d'idempotence ci-dessus avant que l'autre
    // n'ait commité — la contrainte UNIQUE en base est le filet de sécurité
    // final, à traiter comme « déjà enregistré » plutôt que comme une erreur.
    if (err.code === 'ER_DUP_ENTRY') {
      return { alreadyRecorded: true };
    }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { recordConfirmedOnlinePayment };
