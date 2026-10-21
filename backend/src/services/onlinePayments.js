'use strict';

const crypto = require('crypto');
const { pool } = require('../config/db');
const config = require('../config/env');
const { ApiError } = require('../middleware/error');
const logger = require('../utils/logger');
const fedapay = require('./payments/fedapay');
const { recordConfirmedOnlinePayment } = require('./paymentVerification');

/**
 * Encaissement en ligne FedaPay (loyers, charges SONEB/SBEE, liens de paiement).
 *
 * Principes de sécurité :
 *  - Le navigateur ne fournit JAMAIS ni la référence interne, ni l'identifiant de transaction : il reçoit une
 *    `reference` aléatoire (128 bits) créée ici, liée côté serveur à un bail / une facture / un lien précis.
 *  - Rien n'est enregistré sans relecture serveur de la transaction chez FedaPay : statut `approved`, montant
 *    identique à l'intention, référence de l'intention présente dans la transaction.
 *  - Enregistrement unique : intention verrouillée + clé d'idempotence en base (`fedapay:<id>`).
 */
function newReference() {
  return crypto.randomBytes(16).toString('hex');
}

async function startCheckout({ tenant, kind, leaseId = null, chargeId = null, linkId = null, amount, customer }) {
  if (!tenant.fedapay_collect_enabled || !tenant.fedapay_secret_key_enc) {
    throw new ApiError(400, "Le paiement en ligne n'est pas activé pour cette entreprise.");
  }
  if (!Number.isInteger(amount) || amount < 100 || amount > 100_000_000) throw new ApiError(400, 'Montant invalide');
  const reference = newReference();
  const [result] = await pool.query(
    `INSERT INTO online_payment_intents (tenant_id, reference, kind, lease_id, charge_id, link_id, amount)
     VALUES (:tenantId, :reference, :kind, :leaseId, :chargeId, :linkId, :amount)`,
    { tenantId: tenant.id, reference, kind, leaseId, chargeId, linkId, amount },
  );
  try {
    const checkout = await fedapay.createCheckout(tenant, {
      amount,
      description: kind === 'rent' ? 'Loyer' : 'Charges (eau/électricité)',
      callbackUrl: `${config.frontendUrl}/paiement/retour?ref=${reference}`,
      reference,
      customer,
    });
    await pool.query('UPDATE online_payment_intents SET fedapay_transaction_id = :tx WHERE id = :id', { tx: checkout.transactionId, id: result.insertId });
    return { url: checkout.url, reference };
  } catch (err) {
    await pool.query("UPDATE online_payment_intents SET status = 'failed', failure_reason = 'Création de la transaction impossible' WHERE id = :id", { id: result.insertId });
    logger.warn('FedaPay : création de la transaction impossible', { tenantId: tenant.id, message: err.message });
    throw new ApiError(502, 'Le service de paiement est momentanément indisponible. Réessayez dans un instant.');
  }
}

/**
 * Relit la transaction chez FedaPay et, si elle est approuvée, enregistre le paiement (une seule fois).
 * Retourne un état simple pour la page de retour : 'paid' | 'pending' | 'failed'.
 */
async function confirmIntent(intentRow) {
  if (intentRow.status === 'paid') return { state: 'paid' };
  if (intentRow.status === 'failed' || !intentRow.fedapay_transaction_id) return { state: 'failed' };

  const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: intentRow.tenant_id });
  if (!tenant) return { state: 'failed' };

  let tx;
  try {
    tx = await fedapay.getTransaction(tenant, intentRow.fedapay_transaction_id);
  } catch (err) {
    logger.warn('FedaPay : lecture de la transaction impossible', { intentId: intentRow.id, message: err.message });
    return { state: 'pending' };
  }
  if (tx.status === 'pending' || tx.status === '') return { state: 'pending' };
  if (tx.status !== 'approved') {
    await pool.query("UPDATE online_payment_intents SET status = 'failed', failure_reason = :r WHERE id = :id AND status = 'pending'", { r: `Statut ${tx.status}`.slice(0, 190), id: intentRow.id });
    return { state: 'failed' };
  }
  // Contrôles d'intégrité : la transaction doit être CELLE de cette intention, pour CE montant.
  if (tx.reference !== intentRow.reference || tx.amount !== Number(intentRow.amount)) {
    await pool.query("UPDATE online_payment_intents SET status = 'failed', failure_reason = 'ANOMALIE : transaction non conforme' WHERE id = :id AND status = 'pending'", { id: intentRow.id });
    logger.error('FedaPay : transaction non conforme à l\'intention', { intentId: intentRow.id });
    return { state: 'failed' };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[locked]] = await conn.query('SELECT * FROM online_payment_intents WHERE id = :id FOR UPDATE', { id: intentRow.id });
    if (locked.status === 'paid') {
      await conn.rollback();
      return { state: 'paid' };
    }
    await conn.commit();
  } finally {
    conn.release();
  }

  try {
    await recordConfirmedOnlinePayment({
      tenant,
      kind: intentRow.kind,
      leaseId: intentRow.lease_id,
      chargeId: intentRow.charge_id,
      linkId: intentRow.link_id,
      transactionKey: `fedapay:${tx.id}`,
      amount: tx.amount,
      paymentMethod: 'mobile_money',
    });
  } catch (err) {
    if (err instanceof ApiError) {
      // Argent encaissé mais non enregistrable (mois clôturé, facture déjà soldée…) : trace pour régularisation.
      await pool.query("UPDATE online_payment_intents SET failure_reason = :r WHERE id = :id", { r: `À régulariser : ${err.message}`.slice(0, 190), id: intentRow.id });
      logger.error('Paiement en ligne encaissé mais non enregistré', { intentId: intentRow.id, message: err.message });
      return { state: 'paid' };
    }
    throw err;
  }
  await pool.query("UPDATE online_payment_intents SET status = 'paid', paid_at = NOW() WHERE id = :id", { id: intentRow.id });
  return { state: 'paid' };
}

async function confirmByReference(reference) {
  if (typeof reference !== 'string' || !/^[a-f0-9]{32}$/.test(reference)) throw new ApiError(404, 'Paiement introuvable');
  const [[row]] = await pool.query('SELECT * FROM online_payment_intents WHERE reference = :reference LIMIT 1', { reference });
  if (!row) throw new ApiError(404, 'Paiement introuvable');
  return confirmIntent(row);
}

async function confirmByTransaction(tenantId, transactionId) {
  const [[row]] = await pool.query('SELECT * FROM online_payment_intents WHERE tenant_id = :tenantId AND fedapay_transaction_id = :tx LIMIT 1', { tenantId, tx: String(transactionId) });
  if (!row) return null;
  return confirmIntent(row);
}

module.exports = { startCheckout, confirmByReference, confirmByTransaction };
