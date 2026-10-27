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
 * Annulation d'abonnement avec remboursement. Montant : au prorata des jours restants au jour de la demande ; pendant
 * la garantie de 15 jours qui suit le PREMIER paiement, le premier paiement est remboursé en entier (promesse
 * « satisfait ou remboursé » de la page Tarifs). À l'acceptation, l'accès de l'entreprise est coupé. Parcours :
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

const OPEN_STATUSES = ['requested', 'approved', 'details_received', 'processing', 'failed'];

const { computeUnusedValue } = require('./subscriptionCredit');
const computeProrata = computeUnusedValue;

async function requestRefund({ tenantId, userId, reason }) {
  const text = String(reason ?? '').trim();
  if (text.length < 10 || text.length > 1000) throw new ApiError(400, "Expliquez le motif de votre demande d'annulation (10 à 1000 caractères).");
  const conn = await pool.getConnection();
  let id;
  try {
    await conn.beginTransaction();
    await conn.query('SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id = :t FOR UPDATE', { t: tenantId });
    const [[s]] = await conn.query(
      "SELECT status, plan_key, (current_period_end IS NOT NULL AND current_period_end > NOW()) AS running, (refund_eligible_until IS NOT NULL AND refund_eligible_until > NOW()) AS guarantee FROM tenant_subscriptions WHERE tenant_id = :t",
      { t: tenantId },
    );
    if (!s || s.status !== 'active' || s.plan_key === 'interne' || s.plan_key === 'partenaire' || Number(s.running) !== 1) throw new ApiError(400, "Aucun abonnement actif à annuler.");
    const [[open]] = await conn.query(`SELECT id FROM subscription_refunds WHERE tenant_id = :t AND status IN (${OPEN_STATUSES.map((x) => `'${x}'`).join(',')}) LIMIT 1`, { t: tenantId });
    if (open) throw new ApiError(409, "Une demande d'annulation est déjà en cours d'examen.");
    const [[last]] = await conn.query("SELECT id FROM subscription_payments WHERE tenant_id = :t AND status = 'paid' AND consumed_at IS NULL ORDER BY id DESC LIMIT 1", { t: tenantId });
    if (!last) throw new ApiError(400, 'Aucun paiement remboursable.');

    const pr = await computeProrata(conn, tenantId);
    let base = pr.base; let original = pr.original; let days = pr.days; let paymentId = last.id;
    if (Number(s.guarantee) === 1) {
      const [[first]] = await conn.query("SELECT id, amount FROM subscription_payments WHERE tenant_id = :t AND status = 'paid' AND is_first_purchase = 1 AND consumed_at IS NULL ORDER BY id LIMIT 1", { t: tenantId });
      if (first) { base = Number(first.amount); original = Number(first.amount); paymentId = first.id; }
    }
    if (base <= 0) throw new ApiError(400, "Il ne reste aucun jour remboursable sur votre abonnement.");
    const [ins] = await conn.query(
      "INSERT INTO subscription_refunds (tenant_id, payment_id, kind, reason, requested_by, amount_paid, days_remaining, amount_original) VALUES (:t, :p, 'cancellation', :reason, :u, :amount, :days, :orig)",
      { t: tenantId, p: paymentId, reason: text, u: userId, amount: base, days, orig: original },
    );
    id = ins.insertId;
    await logEvent(conn, tenantId, 'cancellation_requested', `user:${userId}`, { refundId: id, base, days });
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
      to: config.platform.adminEmail, subject: `Demande d'annulation de ${dg.company}`, heading: "Nouvelle demande d'annulation",
      paragraphs: [`${dg.company} demande l'annulation de son abonnement.`, `Motif indiqué : ${text}`], linkUrl: `${config.frontendUrl}/admin/remboursements`, linkLabel: 'Ouvrir le back-office',
    });
  }
  return { id };
}

const publicRefund = (r, full = false) => ({
  id: r.id, tenantId: r.tenant_id, companyName: r.company_name, status: r.status, kind: r.kind, reason: r.reason,
  daysRemaining: r.days_remaining, amountOriginal: r.amount_original, payeeFirstName: r.payee_first_name, payeeAccountType: r.payee_account_type,
  payeeAccountNumber: r.payee_account_number ? (full ? r.payee_account_number : `${r.payee_account_number.slice(0, 4)}••••${r.payee_account_number.slice(-2)}`) : null,
  payeeAccountLabel: r.payee_account_label, payeeOtherDetail: r.payee_other_detail, paidManually: !!r.paid_manually,
  amountPaid: r.amount_paid, feeAmount: r.fee_amount, refundAmount: r.refund_amount, adminNote: r.admin_note,
  payeeName: r.payee_name, payeePhone: r.payee_phone ? (full ? r.payee_phone : `${r.payee_phone.slice(0, 6)}••••${r.payee_phone.slice(-2)}`) : null, payeeOperator: r.payee_operator,
  createdAt: r.created_at, decidedAt: r.decided_at, paidAt: r.paid_at,
});

async function listRefunds({ tenantId = null, status = null, full = false } = {}) {
  const [rows] = await pool.query(
    `SELECT r.*, t.company_name FROM subscription_refunds r JOIN tenants t ON t.id = r.tenant_id
     WHERE (:tenantId IS NULL OR r.tenant_id = :tenantId) AND (:status IS NULL OR r.status = :status) ORDER BY r.id DESC LIMIT 200`,
    { tenantId, status },
  );
  return rows.map((r) => publicRefund(r, full));
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
  // L'annulation acceptée coupe l'accès tout de suite : l'entreprise est remboursée de la période non utilisée.
  await pool.query("UPDATE tenant_subscriptions SET status = 'cancelled', refund_eligible_until = NULL WHERE tenant_id = :t AND plan_key <> 'interne'", { t: r.tenant_id });
  const dg = await dgOf(r.tenant_id);
  if (dg.email) {
    const days = r.days_remaining != null ? ` pour ${r.days_remaining} jour${r.days_remaining > 1 ? 's' : ''} restant${r.days_remaining > 1 ? 's' : ''}` : '';
    await sendBillingEmail({
      to: dg.email, subject: "Votre demande d'annulation est acceptée", heading: "Annulation acceptée",
      paragraphs: [
        `Bonjour ${dg.name}, nous avons accepté votre demande d'annulation. L'accès à votre espace est désormais fermé.`,
        `Montant à vous rembourser : ${refundAmount} FCFA${days} (${r.amount_paid} FCFA, moins ${fee} FCFA de frais du prestataire de paiement).`,
        `Pour recevoir ce remboursement, indiquez-nous votre nom, votre prénom et le compte à créditer. Le lien est valable ${TOKEN_TTL_DAYS} jours et ne peut servir qu'une fois.`,
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
    await sendBillingEmail({ to: dg.email, subject: "Réponse à votre demande d'annulation", heading: "Demande d'annulation refusée", paragraphs: [`Bonjour ${dg.name}, nous ne pouvons pas donner suite à votre demande d'annulation. Votre abonnement reste actif.`, `Motif : ${text}`] });
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

const ACCOUNT_TYPES = ['mtn', 'moov', 'celtiis', 'banque', 'autre'];

/**
 * Coordonnées de réception. Nouveau format : { lastName, firstName, accountType, accountNumber, accountLabel, otherDetail }.
 * Ancien format conservé : { name, phone, operator } (Mobile Money MTN ou Moov).
 */
async function submitDetails(token, body) {
  const r = await byToken(token);
  const b = body ?? {};
  const legacy = b.operator !== undefined && b.accountType === undefined;
  const accountType = legacy ? b.operator : b.accountType;
  if (!ACCOUNT_TYPES.includes(accountType)) throw new ApiError(400, 'Type de compte invalide.');
  const lastName = String(legacy ? b.name : b.lastName ?? '').trim();
  const firstName = String(b.firstName ?? '').trim();
  if (lastName.length < 2 || lastName.length > 100) throw new ApiError(400, 'Nom du titulaire invalide.');
  if (!legacy && (firstName.length < 2 || firstName.length > 80)) throw new ApiError(400, 'Prénom invalide.');
  const rawNumber = String(legacy ? b.phone : b.accountNumber ?? '').trim();
  const mobile = accountType === 'mtn' || accountType === 'moov' || accountType === 'celtiis';
  let phone = null; let accountNumber = null;
  if (mobile) {
    phone = normalizeBeninPhone(rawNumber);
    if (!phone) throw new ApiError(400, 'Numéro Mobile Money invalide.');
    accountNumber = phone;
  } else {
    if (rawNumber.length < 5 || rawNumber.length > 60) throw new ApiError(400, 'Numéro de compte invalide.');
    accountNumber = rawNumber;
  }
  const label = String(b.accountLabel ?? '').trim();
  if (!legacy && (label.length < 2 || label.length > 120)) throw new ApiError(400, "Indiquez l'intitulé du compte.");
  const other = String(b.otherDetail ?? '').trim();
  if (accountType === 'autre' && (other.length < 2 || other.length > 120)) throw new ApiError(400, 'Précisez le type de compte.');
  const [upd] = await pool.query(
    `UPDATE subscription_refunds SET status = 'details_received', payee_name = :ln, payee_first_name = :fn, payee_phone = :p,
       payee_operator = :op, payee_account_type = :at, payee_account_number = :an, payee_account_label = :al, payee_other_detail = :od,
       token_hash = NULL, token_expires_at = NULL WHERE id = :id AND status = 'approved'`,
    {
      ln: lastName, fn: firstName || null, p: phone, op: accountType === 'mtn' || accountType === 'moov' ? accountType : null,
      at: accountType, an: accountNumber, al: label || null, od: accountType === 'autre' ? other : null, id: r.id,
    },
  );
  if (upd.affectedRows !== 1) throw new ApiError(404, 'Lien invalide ou expiré.');
  await logEvent(pool, r.tenant_id, 'refund_details_received', 'client', { refundId: r.id });
  if (config.platform.adminEmail) {
    await sendBillingEmail({
      to: config.platform.adminEmail, subject: `Coordonnées reçues de ${r.company_name}`, heading: 'Coordonnées de remboursement reçues',
      paragraphs: [`${r.company_name} a indiqué où recevoir ${r.refund_amount} FCFA. Vous pouvez effectuer le remboursement.`], linkUrl: `${config.frontendUrl}/admin/remboursements`, linkLabel: 'Ouvrir le back-office',
    });
  }
}

async function finalizePaid(refund, { manual = false, reference = null } = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [upd] = await conn.query("UPDATE subscription_refunds SET status = 'paid', paid_at = NOW(), paid_manually = :m, paid_reference = :ref WHERE id = :id AND status IN ('processing','failed','details_received')", { id: refund.id, m: manual ? 1 : 0, ref: reference });
    if (upd.affectedRows === 1) {
      if (refund.kind !== 'cancellation') await conn.query("UPDATE subscription_payments SET status = 'refunded' WHERE id = :p", { p: refund.payment_id });
      await conn.query("UPDATE tenant_subscriptions SET status = :st, refund_eligible_until = NULL WHERE tenant_id = :t AND plan_key <> 'interne'", { st: refund.kind === 'cancellation' ? 'cancelled' : 'refunded', t: refund.tenant_id });
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
    await sendBillingEmail({ to: dg.email, subject: 'Votre remboursement a été envoyé', heading: 'Remboursement envoyé', paragraphs: [`Bonjour ${dg.name}, nous venons de vous envoyer ${refund.refund_amount} FCFA sur le compte que vous avez indiqué. Votre abonnement est clôturé.`, "Merci d'avoir utilisé Africa Immo Management. Vous pouvez vous réabonner à tout moment."] });
  }
}

/** Déclenche le virement FedaPay. Réservé à l'admin ; ne s'exécute qu'une fois (transition atomique vers `processing`). */
async function pay({ id, adminId }) {
  const r = await load(id);
  if (r.payee_account_type && !['mtn', 'moov'].includes(r.payee_account_type)) {
    throw new ApiError(409, "Ce compte n'est pas un Mobile Money MTN ou Moov : effectuez le virement vous-même, puis cliquez sur « Marquer comme payé ».");
  }
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

/** Remboursement effectué hors FedaPay (virement bancaire, Celtiis, autre) : l'admin confirme avec une référence. */
async function markPaidManually({ id, adminId, reference }) {
  const ref = String(reference ?? '').trim();
  if (ref.length < 3 || ref.length > 120) throw new ApiError(400, 'Indiquez la référence du virement.');
  const r = await load(id);
  if (r.status !== 'details_received') throw new ApiError(409, "Ce remboursement n'est pas prêt à être marqué comme payé.");
  await finalizePaid(r, { manual: true, reference: ref });
  await logEvent(pool, r.tenant_id, 'refund_paid_manually', `admin:${adminId}`, { refundId: id, reference: ref });
  return { status: 'paid' };
}

module.exports = { markPaidManually, requestRefund, listRefunds, approve, reject, tokenInfo, submitDetails, pay, refresh };
