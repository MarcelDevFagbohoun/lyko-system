'use strict';

const crypto = require('crypto');
const { pool } = require('../config/db');
const config = require('../config/env');
const { ApiError } = require('../middleware/error');
const logger = require('../utils/logger');
const fedapay = require('./payments/fedapay');
const { platformAccount } = require('./billing');
const { normalizeBeninPhone } = require('./payments/phone');
const { sendBillingEmail } = require('./email/sendEmail');

/**
 * Remboursement sous garantie (15 jours après le PREMIER paiement). Parcours :
 *   requested  → le DG demande, en donnant sa raison
 *   approved   → l'admin de la plateforme valide (frais FedaPay retenus fixés) : le DG reçoit un lien à usage unique par courriel
 *   details_received → le DG a saisi son numéro Mobile Money via ce lien
 *   processing → l'admin déclenche le virement FedaPay (compte de la plateforme)
 *   paid       → virement confirmé par FedaPay : abonnement clôturé (« refunded »), paiement marqué remboursé
 *   rejected / failed : refus motivé / virement en échec (relançable)
 */
const TOKEN_TTL_DAYS = 7;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

async function dgOf(tenantId) {
  const [[u]] = await pool.query("SELECT first_name, email FROM users WHERE tenant_id = :t AND role = 'dg' AND email IS NOT NULL ORDER BY id LIMIT 1", { t: tenantId });
  const [[t]] = await pool.query('SELECT company_name FROM tenants WHERE id = :t', { t: tenantId });
  return { email: u?.email ?? null, name: u?.first_name ?? '', company: t?.company_name ?? '' };
}

async function logEvent(conn, tenantId, type, actor, details) {
  await conn.query('INSERT INTO subscription_events (tenant_id, event_type, actor, details) VALUES (:tenantId, :type, :actor, :details)', {
    tenantId, type, actor, details: details ? JSON.stringify(details) : null,
  });
}

async function requestRefund({ tenantId, userId, reason }) {
  const text = String(reason ?? '').trim();
  if (text.length < 10 || text.length > 1000) throw new ApiError(400, 'Expliquez la raison de votre demande (10 à 1000 caractères).');
  const conn = await pool.getConnection();
  let id;
  try {
    await conn.beginTransaction();
    await conn.query('SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id = :t FOR UPDATE', { t: tenantId });
    const [[s]] = await conn.query('SELECT status, (refund_eligible_until IS NOT NULL AND refund_eligible_until > NOW()) AS open FROM tenant_subscriptions WHERE tenant_id = :t', { t: tenantId });
    if (!s || s.status !== 'active' || Number(s.open) !== 1) throw new ApiError(400, "Le délai de remboursement de 15 jours est dépassé ou ne s'applique pas à votre abonnement.");
    const [[p]] = await conn.query("SELECT id, amount FROM subscription_payments WHERE tenant_id = :t AND status = 'paid' AND is_first_purchase = 1 ORDER BY id LIMIT 1", { t: tenantId });
    if (!p) throw new ApiError(400, 'Aucun paiement remboursable.');
    const [[exists]] = await conn.query('SELECT id FROM subscription_refunds WHERE payment_id = :p LIMIT 1', { p: p.id });
    if (exists) throw new ApiError(409, 'Une demande de remboursement existe déjà pour ce paiement.');
    const [ins] = await conn.query(
      'INSERT INTO subscription_refunds (tenant_id, payment_id, reason, requested_by, amount_paid) VALUES (:t, :p, :reason, :u, :amount)',
      { t: tenantId, p: p.id, reason: text, u: userId, amount: p.amount },
    );
    id = ins.insertId;
    await logEvent(conn, tenantId, 'refund_requested', `user:${userId}`, { refundId: id });
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  if (config.platform.adminEmail) {
    const dg = await dgOf(tenantId);
    await sendBillingEmail({
      to: config.platform.adminEmail, subject: `Demande de remboursement — ${dg.company}`, heading: 'Nouvelle demande de remboursement',
      paragraphs: [`${dg.company} demande le remboursement de son premier abonnement.`, `Raison : ${text}`], linkUrl: `${config.frontendUrl}/admin/remboursements`, linkLabel: 'Ouvrir le back-office',
    });
  }
  return { id };
}

const publicRefund = (r) => ({
  id: r.id, tenantId: r.tenant_id, companyName: r.company_name, status: r.status, reason: r.reason,
  amountPaid: r.amount_paid, feeAmount: r.fee_amount, refundAmount: r.refund_amount, adminNote: r.admin_note,
  payeeName: r.payee_name, payeePhone: r.payee_phone ? `${r.payee_phone.slice(0, 6)}••••${r.payee_phone.slice(-2)}` : null, payeeOperator: r.payee_operator,
  createdAt: r.created_at, decidedAt: r.decided_at, paidAt: r.paid_at,
});

async function listRefunds({ tenantId = null, status = null } = {}) {
  const [rows] = await pool.query(
    `SELECT r.*, t.company_name FROM subscription_refunds r JOIN tenants t ON t.id = r.tenant_id
     WHERE (:tenantId IS NULL OR r.tenant_id = :tenantId) AND (:status IS NULL OR r.status = :status) ORDER BY r.id DESC LIMIT 200`,
    { tenantId, status },
  );
  return rows.map(publicRefund);
}

async function load(id) {
  const [[r]] = await pool.query('SELECT r.*, t.company_name FROM subscription_refunds r JOIN tenants t ON t.id = r.tenant_id WHERE r.id = :id', { id });
  if (!r) throw new ApiError(404, 'Demande introuvable');
  return r;
}

async function approve({ id, adminId, feeAmount = null, note = null }) {
  const r = await load(id);
  const fee = feeAmount ?? Math.ceil((r.amount_paid * config.platform.refundFeePercent) / 100);
  if (!Number.isInteger(fee) || fee < 0 || fee >= r.amount_paid - 100) throw new ApiError(400, 'Frais invalides');
  const refundAmount = r.amount_paid - fee;
  const token = crypto.randomBytes(32).toString('hex');
  const [upd] = await pool.query(
    `UPDATE subscription_refunds SET status = 'approved', fee_amount = :fee, refund_amount = :refund, admin_note = :note, decided_by = :admin, decided_at = NOW(),
       token_hash = :hash, token_expires_at = DATE_ADD(NOW(), INTERVAL ${TOKEN_TTL_DAYS} DAY)
     WHERE id = :id AND status = 'requested'`,
    { fee, refund: refundAmount, note, admin: adminId, hash: sha256(token), id },
  );
  if (upd.affectedRows !== 1) throw new ApiError(409, 'Cette demande a déjà été traitée.');
  await logEvent(pool, r.tenant_id, 'refund_approved', `admin:${adminId}`, { refundId: id, fee, refundAmount });
  const dg = await dgOf(r.tenant_id);
  if (dg.email) {
    await sendBillingEmail({
      to: dg.email, subject: 'Votre remboursement est accepté — indiquez où le recevoir', heading: 'Remboursement accepté',
      paragraphs: [
        `Bonjour ${dg.name}, votre demande de remboursement est acceptée.`,
        `Montant à vous rembourser : ${refundAmount} FCFA (${r.amount_paid} FCFA payés, moins ${fee} FCFA de frais du prestataire de paiement).`,
        `Indiquez le numéro Mobile Money qui recevra le virement (lien valable ${TOKEN_TTL_DAYS} jours, utilisable une seule fois).`,
      ],
      linkUrl: `${config.frontendUrl}/abonnement/remboursement?token=${token}`, linkLabel: 'Indiquer mes coordonnées',
    });
  }
  return { id, refundAmount, feeAmount: fee };
}

async function reject({ id, adminId, note }) {
  const text = String(note ?? '').trim();
  if (text.length < 5) throw new ApiError(400, 'Indiquez le motif du refus.');
  const r = await load(id);
  const [upd] = await pool.query("UPDATE subscription_refunds SET status = 'rejected', admin_note = :note, decided_by = :admin, decided_at = NOW() WHERE id = :id AND status = 'requested'", { note: text.slice(0, 500), admin: adminId, id });
  if (upd.affectedRows !== 1) throw new ApiError(409, 'Cette demande a déjà été traitée.');
  await logEvent(pool, r.tenant_id, 'refund_rejected', `admin:${adminId}`, { refundId: id });
  const dg = await dgOf(r.tenant_id);
  if (dg.email) {
    await sendBillingEmail({ to: dg.email, subject: 'Votre demande de remboursement', heading: 'Demande de remboursement refusée', paragraphs: [`Bonjour ${dg.name}, votre demande n'a pas pu être acceptée.`, `Motif : ${text}`] });
  }
}

async function byToken(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token))) throw new ApiError(404, 'Lien invalide ou expiré.');
  const [[r]] = await pool.query(
    "SELECT r.*, t.company_name FROM subscription_refunds r JOIN tenants t ON t.id = r.tenant_id WHERE r.token_hash = :h AND r.status = 'approved' AND r.token_expires_at > NOW()",
    { h: sha256(token) },
  );
  if (!r) throw new ApiError(404, 'Lien invalide ou expiré.');
  return r;
}

const tokenInfo = async (token) => {
  const r = await byToken(token);
  return { companyName: r.company_name, refundAmount: r.refund_amount };
};

async function submitDetails(token, { name, phone, operator }) {
  const r = await byToken(token);
  const n = String(name ?? '').trim();
  const p = normalizeBeninPhone(String(phone ?? ''));
  if (n.length < 3 || n.length > 100) throw new ApiError(400, 'Nom du titulaire invalide.');
  if (!p) throw new ApiError(400, 'Numéro Mobile Money invalide.');
  if (!['mtn', 'moov'].includes(operator)) throw new ApiError(400, 'Opérateur invalide.');
  const [upd] = await pool.query(
    "UPDATE subscription_refunds SET status = 'details_received', payee_name = :n, payee_phone = :p, payee_operator = :o, token_hash = NULL, token_expires_at = NULL WHERE id = :id AND status = 'approved'",
    { n, p, o: operator, id: r.id },
  );
  if (upd.affectedRows !== 1) throw new ApiError(404, 'Lien invalide ou expiré.');
  await logEvent(pool, r.tenant_id, 'refund_details_received', 'client', { refundId: r.id });
}

async function finalizePaid(refund) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [upd] = await conn.query("UPDATE subscription_refunds SET status = 'paid', paid_at = NOW() WHERE id = :id AND status IN ('processing','failed')", { id: refund.id });
    if (upd.affectedRows === 1) {
      await conn.query("UPDATE subscription_payments SET status = 'refunded' WHERE id = :p", { p: refund.payment_id });
      await conn.query("UPDATE tenant_subscriptions SET status = 'refunded', refund_eligible_until = NULL WHERE tenant_id = :t", { t: refund.tenant_id });
      await logEvent(conn, refund.tenant_id, 'refunded', 'fedapay', { refundId: refund.id, amount: refund.refund_amount });
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  const dg = await dgOf(refund.tenant_id);
  if (dg.email) {
    await sendBillingEmail({ to: dg.email, subject: 'Remboursement envoyé', heading: 'Remboursement envoyé', paragraphs: [`Bonjour ${dg.name}, ${refund.refund_amount} FCFA viennent d'être envoyés sur votre compte Mobile Money. Votre abonnement est clôturé.`] });
  }
}

/** Déclenche le virement FedaPay. Réservé à l'admin ; ne s'exécute qu'une fois (transition atomique vers `processing`). */
async function pay({ id, adminId }) {
  const r = await load(id);
  const [claim] = await pool.query("UPDATE subscription_refunds SET status = 'processing' WHERE id = :id AND status IN ('details_received','failed') AND payout_id IS NULL", { id });
  if (claim.affectedRows !== 1) throw new ApiError(409, "Ce remboursement n'est pas prêt à être payé (coordonnées manquantes ou virement déjà lancé).");
  const account = platformAccount();
  try {
    const payout = await fedapay.createPayout(account, {
      amount: r.refund_amount, name: r.payee_name, phone: r.payee_phone, operator: r.payee_operator,
      description: `Remboursement abonnement Africa Immo Management #${id}`, reference: `REFUND-${id}`,
    });
    await pool.query('UPDATE subscription_refunds SET payout_id = :p WHERE id = :id', { p: payout.id, id });
    await fedapay.startPayout(account, payout.id);
    await logEvent(pool, r.tenant_id, 'refund_payout_started', `admin:${adminId}`, { refundId: id });
  } catch (err) {
    // Si le virement n'a pas été créé chez FedaPay on peut relancer ; sinon (créé) on laisse « processing » à relire.
    const [[cur]] = await pool.query('SELECT payout_id FROM subscription_refunds WHERE id = :id', { id });
    if (!cur.payout_id) await pool.query("UPDATE subscription_refunds SET status = 'failed' WHERE id = :id", { id });
    logger.warn('Remboursement : virement non lancé', { id, message: err.message });
    throw new ApiError(502, "Le virement n'a pas pu être lancé. Réessayez dans un instant.");
  }
  return refresh({ id });
}

/** Relit l'état réel du virement chez FedaPay. */
async function refresh({ id }) {
  const r = await load(id);
  if (r.status !== 'processing' || !r.payout_id) return { status: r.status };
  const p = await fedapay.getPayout(platformAccount(), r.payout_id);
  if (p.status === 'sent') {
    await finalizePaid(r);
    return { status: 'paid' };
  }
  if (p.status === 'failed') {
    await pool.query("UPDATE subscription_refunds SET status = 'failed', payout_id = NULL WHERE id = :id AND status = 'processing'", { id });
    return { status: 'failed' };
  }
  return { status: 'processing' };
}

module.exports = { requestRefund, listRefunds, approve, reject, tokenInfo, submitDetails, pay, refresh };
