'use strict';

const crypto = require('crypto');
const { pool } = require('../config/db');
const config = require('../config/env');
const { ApiError } = require('../middleware/error');
const logger = require('../utils/logger');
const fedapay = require('./payments/fedapay');
const { encryptSecret } = require('../utils/encryption');
const { PLANS, FOUNDER_OFFER, REFUND_WINDOW_DAYS, getPlan } = require('../constants/plans');

/**
 * Facturation des abonnements via le compte FedaPay de la PLATEFORME (variables PLATFORM_FEDAPAY_*).
 * Mêmes principes que l'encaissement des loyers : le navigateur ne fournit ni montant ni identifiant de transaction ;
 * rien n'est activé sans relecture serveur de la transaction (statut approuvé, montant identique, référence présente) ;
 * activation unique (ligne de paiement verrouillée). Renouvellement MANUEL : aucun prélèvement automatique.
 */

/** Le client FedaPay attend un objet « entreprise » : on lui en présente un, construit depuis la configuration. */
function platformAccount() {
  const { fedapaySecretKey, fedapayWebhookSecret, fedapaySandbox } = config.platform;
  if (!fedapaySecretKey) throw new ApiError(503, "Le paiement des abonnements n'est pas encore configuré.");
  return {
    id: 0,
    fedapay_enabled: 1,
    fedapay_collect_enabled: 1,
    fedapay_sandbox: fedapaySandbox ? 1 : 0,
    fedapay_secret_key_enc: encryptSecret(fedapaySecretKey),
    fedapay_webhook_secret_enc: fedapayWebhookSecret ? encryptSecret(fedapayWebhookSecret) : null,
  };
}

function verifyPlatformWebhook(rawBody, header) {
  if (!config.platform.fedapayWebhookSecret) return false;
  return fedapay.verifyWebhookSignature(platformAccount(), rawBody, header);
}

function findOffer(planKey, months) {
  const plan = getPlan(planKey);
  if (!plan || planKey === 'interne') return null;
  const offer = plan.offers.find((o) => o.months === months);
  return offer ? { plan, offer } : null;
}

/** Nombre de places « tarif fondateur » déjà prises (achats payés + réservations récentes non terminées). */
async function founderTaken(conn = pool) {
  const [[r]] = await conn.query(
    `SELECT COUNT(DISTINCT tenant_id) AS n FROM subscription_payments
     WHERE founder_price = 1 AND (status = 'paid' OR (status = 'pending' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)))`,
  );
  return Number(r.n);
}

/** Prix réellement dû par cette entreprise pour cette offre (tarif fondateur inclus). */
async function quote(tenantId, planKey, months, conn = pool) {
  const found = findOffer(planKey, months);
  if (!found) throw new ApiError(400, 'Offre inconnue');
  const [[paid]] = await conn.query("SELECT COUNT(*) AS n FROM subscription_payments WHERE tenant_id = :tenantId AND status IN ('paid','refunded')", { tenantId });
  const isFirst = Number(paid.n) === 0;
  let price = found.offer.price;
  let founder = false;
  if (isFirst && planKey === FOUNDER_OFFER.planKey && months === FOUNDER_OFFER.months) {
    const [[mine]] = await conn.query("SELECT COUNT(*) AS n FROM subscription_payments WHERE tenant_id = :tenantId AND founder_price = 1 AND status = 'pending' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)", { tenantId });
    const taken = (await founderTaken(conn)) - (Number(mine.n) > 0 ? 1 : 0);
    if (taken < FOUNDER_OFFER.maxCompanies) {
      price = FOUNDER_OFFER.price;
      founder = true;
    }
  }
  return { planKey, months, price, normalPrice: found.offer.price, founder, isFirstPurchase: isFirst };
}

/** Catalogue public (pages tarifs) : prix, limites, fonctions, places fondateur restantes. */
async function publicCatalog() {
  const taken = await founderTaken();
  return {
    plans: Object.values(PLANS)
      .filter((p) => p.key !== 'interne')
      .map((p) => ({ key: p.key, label: p.label, featured: !!p.featured, limits: p.limits, features: p.features, offers: p.offers })),
    founder: { ...FOUNDER_OFFER, remaining: Math.max(0, FOUNDER_OFFER.maxCompanies - taken) },
    refundWindowDays: REFUND_WINDOW_DAYS,
  };
}

async function startCheckout({ tenantId, userId, planKey, months }) {
  const [[sub]] = await pool.query('SELECT plan_key FROM tenant_subscriptions WHERE tenant_id = :tenantId', { tenantId });
  if (sub?.plan_key === 'interne') throw new ApiError(400, "Votre entreprise n'a pas d'abonnement à payer.");
  const q = await quote(tenantId, planKey, months);
  const account = platformAccount();
  const reference = crypto.randomBytes(16).toString('hex');
  const [ins] = await pool.query(
    `INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, amount, founder_price, is_first_purchase, created_by)
     VALUES (:tenantId, :reference, :planKey, :months, :amount, :founder, :first, :userId)`,
    { tenantId, reference, planKey, months, amount: q.price, founder: q.founder ? 1 : 0, first: q.isFirstPurchase ? 1 : 0, userId },
  );
  const [[tenant]] = await pool.query('SELECT company_name FROM tenants WHERE id = :tenantId', { tenantId });
  const [[dg]] = await pool.query('SELECT first_name, last_name, email FROM users WHERE id = :userId', { userId });
  try {
    const checkout = await fedapay.createCheckout(account, {
      amount: q.price,
      description: `Abonnement Lyko System ${getPlan(planKey).label} — ${months} mois`,
      callbackUrl: `${config.frontendUrl}/abonnement/retour?ref=${reference}`,
      reference,
      customer: { name: `${dg?.first_name ?? ''} ${dg?.last_name ?? ''}`.trim() || tenant.company_name, email: dg?.email },
    });
    await pool.query('UPDATE subscription_payments SET fedapay_transaction_id = :tx WHERE id = :id', { tx: checkout.transactionId, id: ins.insertId });
    return { url: checkout.url, reference, amount: q.price, founder: q.founder };
  } catch (err) {
    await pool.query("UPDATE subscription_payments SET status = 'failed' WHERE id = :id", { id: ins.insertId });
    logger.warn('Abonnement : création de la transaction impossible', { tenantId, message: err.message });
    throw new ApiError(502, 'Le service de paiement est momentanément indisponible. Réessayez dans un instant.');
  }
}

async function logEvent(conn, tenantId, type, actor, details) {
  await conn.query('INSERT INTO subscription_events (tenant_id, event_type, actor, details) VALUES (:tenantId, :type, :actor, :details)', {
    tenantId, type, actor, details: details ? JSON.stringify(details) : null,
  });
}

/** Active ou prolonge l'abonnement pour un paiement approuvé. Idempotent : un paiement déjà `paid` ne refait rien. */
async function activatePayment(paymentId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query('SELECT * FROM subscription_payments WHERE id = :id FOR UPDATE', { id: paymentId });
    if (!p || p.status === 'paid') { await conn.rollback(); return false; }
    if (p.status !== 'pending') { await conn.rollback(); return false; }
    const [[s]] = await conn.query(
      'SELECT plan_key, status, (current_period_end IS NOT NULL AND current_period_end > NOW()) AS running FROM tenant_subscriptions WHERE tenant_id = :t FOR UPDATE',
      { t: p.tenant_id },
    );
    const extend = s && s.status === 'active' && Number(s.running) === 1 && s.plan_key === p.plan_key;
    const startExpr = extend ? 'current_period_end' : 'NOW()';
    await conn.query(
      `UPDATE tenant_subscriptions SET plan_key = :plan, status = 'active', period_months = :months,
         started_at = IF(:extend = 1, started_at, NOW()),
         current_period_end = DATE_ADD(${startExpr}, INTERVAL :months MONTH),
         first_purchase_at = COALESCE(first_purchase_at, IF(:first = 1, NOW(), NULL)),
         refund_eligible_until = IF(:first = 1, DATE_ADD(NOW(), INTERVAL ${REFUND_WINDOW_DAYS} DAY), refund_eligible_until),
         founder_price = IF(:founder = 1, 1, founder_price),
         reminder_sent_for = NULL, reminder_days = NULL
       WHERE tenant_id = :t`,
      { plan: p.plan_key, months: p.months, extend: extend ? 1 : 0, first: p.is_first_purchase, founder: p.founder_price, t: p.tenant_id },
    );
    const [[after]] = await conn.query('SELECT started_at, current_period_end FROM tenant_subscriptions WHERE tenant_id = :t', { t: p.tenant_id });
    const invoice = `LYKO-${new Date().getUTCFullYear()}-${String(p.id).padStart(6, '0')}`;
    await conn.query(
      "UPDATE subscription_payments SET status = 'paid', paid_at = NOW(), invoice_number = :invoice, period_start = :ps, period_end = :pe WHERE id = :id",
      { invoice, ps: extend ? null : after.started_at, pe: after.current_period_end, id: p.id },
    );
    await logEvent(conn, p.tenant_id, extend ? 'renewed' : 'activated', 'fedapay', { plan: p.plan_key, months: p.months, amount: p.amount, founder: !!p.founder_price, invoice });
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function confirmRow(payment) {
  if (payment.status === 'paid') return { state: 'paid' };
  if (payment.status !== 'pending' || !payment.fedapay_transaction_id) return { state: 'failed' };
  let tx;
  try {
    tx = await fedapay.getTransaction(platformAccount(), payment.fedapay_transaction_id);
  } catch (err) {
    logger.warn('Abonnement : relecture FedaPay impossible', { id: payment.id, message: err.message });
    return { state: 'pending' };
  }
  if (tx.id !== String(payment.fedapay_transaction_id) || tx.reference !== payment.reference) return { state: 'failed' };
  if (['declined', 'canceled', 'cancelled', 'refunded'].includes(tx.status)) {
    await pool.query("UPDATE subscription_payments SET status = 'failed' WHERE id = :id AND status = 'pending'", { id: payment.id });
    return { state: 'failed' };
  }
  if (tx.status !== 'approved') return { state: 'pending' };
  if (tx.amount !== Number(payment.amount)) {
    logger.error('Abonnement : montant FedaPay différent du montant attendu', { id: payment.id });
    return { state: 'failed' };
  }
  await activatePayment(payment.id);
  return { state: 'paid' };
}

async function confirmByReference(reference) {
  if (!/^[a-f0-9]{32}$/.test(reference)) return { state: 'failed' };
  const [[p]] = await pool.query('SELECT * FROM subscription_payments WHERE reference = :reference', { reference });
  return p ? confirmRow(p) : { state: 'failed' };
}

async function confirmByTransaction(transactionId) {
  const [[p]] = await pool.query('SELECT * FROM subscription_payments WHERE fedapay_transaction_id = :tx', { tx: transactionId });
  return p ? confirmRow(p) : { state: 'failed' };
}

/** État de l'abonnement pour l'espace de l'entreprise. */
async function describe(tenantId) {
  const [[s]] = await pool.query(
    `SELECT plan_key, status, period_months, started_at, current_period_end, first_purchase_at, refund_eligible_until, founder_price,
            (current_period_end IS NOT NULL AND current_period_end > NOW()) AS running,
            (refund_eligible_until IS NOT NULL AND refund_eligible_until > NOW()) AS refund_open,
            DATEDIFF(current_period_end, NOW()) AS days_left
     FROM tenant_subscriptions WHERE tenant_id = :tenantId`,
    { tenantId },
  );
  if (!s) return { planKey: null, status: 'none', active: false };
  const interne = s.plan_key === 'interne';
  const active = s.status === 'active' && (interne || Number(s.running) === 1);
  return {
    planKey: s.plan_key,
    planLabel: s.plan_key ? getPlan(s.plan_key)?.label : null,
    status: active ? 'active' : s.status === 'active' ? 'expired' : s.status,
    active,
    enforced: config.features.subscriptionsEnforced,
    periodMonths: s.period_months,
    currentPeriodEnd: interne ? null : s.current_period_end,
    daysLeft: interne || s.days_left == null ? null : Number(s.days_left),
    refundOpen: Number(s.refund_open) === 1,
    refundEligibleUntil: s.refund_eligible_until,
    founderPrice: !!s.founder_price,
  };
}

module.exports = { platformAccount, verifyPlatformWebhook, findOffer, quote, publicCatalog, startCheckout, activatePayment, confirmByReference, confirmByTransaction, describe, founderTaken };
