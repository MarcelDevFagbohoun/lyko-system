'use strict';

const { ApiError } = require('../middleware/error');
const { pool } = require('../config/db');
const kkiapay = require('./kkiapay');
const { recordRentPayment } = require('../routes/leases');
const { recordUtilityPayment, loadCharge } = require('../routes/charges');

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
 * Point d'entrée UNIQUE pour enregistrer un paiement confirmé par KKiaPay —
 * appelé par les trois chemins possibles (callback client du portail,
 * callback client d'un lien de paiement, webhook), jamais dupliqué :
 *
 *   1. Vérifie d'abord si `transactionId` a déjà été enregistré (idempotence
 *      applicative, avant même de rappeler KKiaPay — évite un aller-retour
 *      réseau inutile sur un webhook retenté).
 *   2. Revérifie la transaction CÔTÉ SERVEUR auprès de KKiaPay — jamais
 *      confiance sur le seul fait que l'appelant dise « succès ».
 *   3. Enregistre via `recordRentPayment`/`recordUtilityPayment` (seuls
 *      points d'insertion dans rent_payments/utility_payments), avec
 *      `recordedBy: null` (aucun employé n'a saisi ce paiement) et le
 *      montant CONFIRMÉ par KKiaPay — jamais un montant fourni par le client.
 *   4. Si `linkId` est fourni (paiement via un lien généré par le
 *      personnel), marque ce lien comme payé.
 *
 * `kind`: 'rent' (leaseId requis) ou 'charge' (chargeId requis).
 *
 * `expectedReference` : la référence interne (`t<tenantId>:rent:<leaseId>` /
 * `:charge:<chargeId>` / `:link:<token>`) posée dans `data`/`partnerId` du
 * widget QUAND CE paiement précis a été ouvert (voir `frontend/lib/kkiapay.ts`).
 * Protège contre un scénario précis : un tiers qui connaîtrait le
 * `transactionId` RÉEL d'un paiement appartenant à quelqu'un d'autre (ex. un
 * autre locataire de la même entreprise) pourrait sinon le soumettre à SON
 * PROPRE contexte (son propre bail/lien) — la revérification KKiaPay
 * confirmerait bien que la transaction existe et a réussi (elle appartient
 * réellement à cette entreprise), mais SANS ce contrôle, le paiement de l'un
 * se retrouverait crédité au bail de l'autre. Si la réponse de KKiaPay
 * n'échoue PAS explicitement ce contrôle (champ de référence absent de leur
 * réponse — à confirmer lors du premier test en sandbox réel), on ne bloque
 * pas : le webhook + l'idempotence par transactionId restent la protection
 * de base dans ce cas.
 */
async function verifyAndRecordKkiapay({ tenant, transactionId, kind, leaseId, chargeId, linkId, expectedReference }) {
  if (!tenant.kkiapay_enabled) {
    throw new ApiError(400, 'Le paiement en ligne est désactivé pour cette entreprise');
  }
  if (kind !== 'rent' && kind !== 'charge') {
    throw new ApiError(400, 'Type de paiement invalide');
  }

  const table = kind === 'rent' ? 'rent_payments' : 'utility_payments';
  const [existing] = await pool.query(
    `SELECT id FROM ${table} WHERE tenant_id = :t AND kkiapay_transaction_id = :tx LIMIT 1`,
    { t: tenant.id, tx: transactionId },
  );
  if (existing[0]) {
    return { alreadyRecorded: true };
  }

  const verification = await kkiapay.verifyTransaction(tenant, transactionId);
  if (!verification.success) {
    throw new ApiError(400, `Paiement non confirmé par KKiaPay (statut : ${verification.status ?? 'inconnu'})`);
  }
  if (!verification.amount || verification.amount <= 0) {
    throw new ApiError(502, 'KKiaPay n\'a renvoyé aucun montant confirmé pour cette transaction');
  }
  const echoedReference =
    verification.raw?.partnerId ?? verification.raw?.partner_id ?? verification.raw?.data ?? verification.raw?.reference;
  if (expectedReference && echoedReference && echoedReference !== expectedReference) {
    throw new ApiError(409, 'Cette transaction ne correspond pas à ce paiement (référence différente)');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (kind === 'rent') {
      await conn.query('SELECT id FROM leases WHERE id = :id FOR UPDATE', { id: leaseId });
      const lease = await loadActiveLeaseForPayment(conn, tenant.id, leaseId);
      await recordRentPayment(conn, {
        tenantId: tenant.id,
        lease,
        coversMonth: null,
        amount: verification.amount,
        paymentMethod: 'kkiapay',
        paidAt: todayIso(),
        notes: null,
        recordedBy: null,
        kkiapayTransactionId: transactionId,
      });
    } else {
      await conn.query('SELECT id FROM utility_charges WHERE id = :id FOR UPDATE', { id: chargeId });
      const charge = await loadCharge(conn, tenant.id, chargeId);
      if (charge.status === 'payee') throw new ApiError(400, 'Cette facture est déjà entièrement réglée');
      await recordUtilityPayment(conn, {
        tenantId: tenant.id,
        charge,
        amount: verification.amount,
        paymentMethod: 'kkiapay',
        paidAt: todayIso(),
        notes: null,
        recordedBy: null,
        kkiapayTransactionId: transactionId,
      });
    }

    if (linkId) {
      await conn.query(
        `UPDATE payment_links SET status = 'paid', paid_at = NOW(), kkiapay_transaction_id = :tx
         WHERE id = :id AND tenant_id = :t`,
        { tx: transactionId, id: linkId, t: tenant.id },
      );
    }

    await conn.commit();
    return { alreadyRecorded: false, amount: verification.amount };
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

module.exports = { verifyAndRecordKkiapay };
