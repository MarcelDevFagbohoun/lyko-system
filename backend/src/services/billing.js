'use strict';

const crypto = require('crypto');
const { pool } = require('../config/db');
const config = require('../config/env');
const { ApiError } = require('../middleware/error');
const logger = require('../utils/logger');
const fedapay = require('./payments/fedapay');
const { encryptSecret } = require('../utils/encryption');
const { getCatalog, getPlanAsync } = require('./planCatalog');
const { computeUnusedValue } = require('./subscriptionCredit');

const PLAN_RANK = { demarrage: 1, pro: 2, entreprise: 3 };
const MIN_PAYABLE = 100; // FCFA : en dessous, FedaPay refuse la transaction

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

async function findOffer(planKey, months) {
  const plan = await getPlanAsync(planKey);
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

/**
 * Prix réellement dû par cette entreprise pour cette offre (tarif fondateur inclus).
 * Abonnement en cours : même offre = renouvellement (la période s'ajoute à la fin de la précédente) ; offre supérieure =
 * montée en gamme (le prorata des jours restants est déduit du prix) ; offre inférieure = refusée jusqu'au terme.
 */
async function quote(tenantId, planKey, months, conn = pool) {
  const found = await findOffer(planKey, months);
  if (!found) throw new ApiError(400, 'Offre inconnue');
  const [[cur]] = await conn.query(
    "SELECT plan_key, status, (current_period_end IS NOT NULL AND current_period_end > NOW()) AS running FROM tenant_subscriptions WHERE tenant_id = :tenantId",
    { tenantId },
  );
  const running = !!cur && cur.status === 'active' && Number(cur.running) === 1 && cur.plan_key !== 'interne';
  let kind = 'purchase';
  let credit = 0; let creditDays = 0; let fromPlan = null;
  if (running) {
    const [[open]] = await conn.query("SELECT id FROM subscription_refunds WHERE tenant_id = :tenantId AND status IN ('requested','approved','details_received','processing','failed') LIMIT 1", { tenantId });
    if (open) throw new ApiError(409, "Une demande d'annulation est en cours d'examen : attendez la réponse avant de renouveler ou de changer d'offre.");
    if (cur.plan_key === planKey) {
      kind = 'renewal';
    } else if ((PLAN_RANK[planKey] ?? 0) > (PLAN_RANK[cur.plan_key] ?? 0)) {
      kind = 'upgrade';
      fromPlan = cur.plan_key;
      const unused = await computeUnusedValue(conn, tenantId);
      credit = unused.base;
      creditDays = unused.days;
    } else {
      throw new ApiError(409, "Vous ne pouvez pas passer à une offre inférieure pendant votre abonnement. Vous pourrez la choisir quand il arrivera à son terme.");
    }
  }
  const [[paid]] = await conn.query("SELECT COUNT(*) AS n FROM subscription_payments WHERE tenant_id = :tenantId AND status IN ('paid','refunded')", { tenantId });
  const isFirst = Number(paid.n) === 0;
  let price = found.offer.price;
  let founder = false;
  const { founder: FOUNDER_OFFER } = await getCatalog();
  if (FOUNDER_OFFER.enabled && isFirst && kind === 'purchase' && planKey === FOUNDER_OFFER.planKey && months === FOUNDER_OFFER.months) {
    const [[mine]] = await conn.query("SELECT COUNT(*) AS n FROM subscription_payments WHERE tenant_id = :tenantId AND founder_price = 1 AND status = 'pending' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)", { tenantId });
    const taken = (await founderTaken(conn)) - (Number(mine.n) > 0 ? 1 : 0);
    if (taken < FOUNDER_OFFER.maxCompanies) {
      price = FOUNDER_OFFER.price;
      founder = true;
    }
  }
  const fullPrice = price;
  if (kind === 'upgrade') {
    if (fullPrice - credit < MIN_PAYABLE) {
      throw new ApiError(409, "Votre crédit couvre déjà presque toute cette offre : choisissez une durée plus longue.");
    }
    price = fullPrice - credit;
  }
  return { planKey, months, kind, price, normalPrice: found.offer.price, fullPrice, credit, creditDays, fromPlan, founder, isFirstPurchase: isFirst };
}

/** Offres supérieures proposées à une entreprise dont l'abonnement court, avec le crédit déjà déduit. */
async function upgradeOptions(tenantId) {
  const [[cur]] = await pool.query(
    "SELECT plan_key, status, (current_period_end IS NOT NULL AND current_period_end > NOW()) AS running FROM tenant_subscriptions WHERE tenant_id = :tenantId",
    { tenantId },
  );
  if (!cur || cur.status !== 'active' || Number(cur.running) !== 1 || cur.plan_key === 'interne') return { options: [] };
  const catalog = await getCatalog();
  const options = [];
  for (const plan of Object.values(catalog.plans)) {
    if ((PLAN_RANK[plan.key] ?? 0) <= (PLAN_RANK[cur.plan_key] ?? 0)) continue;
    for (const o of plan.offers) {
      try {
        const q = await quote(tenantId, plan.key, o.months);
        options.push({ planKey: plan.key, months: o.months, fullPrice: q.fullPrice, credit: q.credit, creditDays: q.creditDays, price: q.price });
      } catch (err) {
        if (!(err instanceof ApiError)) throw err; // offre trop proche du crédit : simplement non proposée
      }
    }
  }
  return { options };
}

/** Catalogue public (pages tarifs) : prix, limites, fonctions, places fondateur restantes. */
async function publicCatalog() {
  const taken = await founderTaken();
  const catalog = await getCatalog();
  const FOUNDER_OFFER = catalog.founder;
  return {
    plans: Object.values(catalog.plans)
      .map((p) => ({ key: p.key, label: p.label, featured: !!p.featured, limits: p.limits, features: p.features, offers: p.offers })),
    founder: { ...FOUNDER_OFFER, remaining: FOUNDER_OFFER.enabled ? Math.max(0, FOUNDER_OFFER.maxCompanies - taken) : 0 },
    refundWindowDays: catalog.refundWindowDays,
  };
}

async function startCheckout({ tenantId, userId, planKey, months }) {
  const [[sub]] = await pool.query('SELECT plan_key FROM tenant_subscriptions WHERE tenant_id = :tenantId', { tenantId });
  if (sub?.plan_key === 'interne') throw new ApiError(400, "Votre entreprise n'a pas d'abonnement à payer.");
  const q = await quote(tenantId, planKey, months);
  const account = platformAccount();
  const reference = crypto.randomBytes(16).toString('hex');
  const [ins] = await pool.query(
    `INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, kind, amount, credit_applied, credit_days, upgraded_from_plan, founder_price, is_first_purchase, created_by)
     VALUES (:tenantId, :reference, :planKey, :months, :kind, :amount, :credit, :creditDays, :fromPlan, :founder, :first, :userId)`,
    { tenantId, reference, planKey, months, kind: q.kind, amount: q.price, credit: q.credit, creditDays: q.creditDays || null, fromPlan: q.fromPlan, founder: q.founder ? 1 : 0, first: q.isFirstPurchase ? 1 : 0, userId },
  );
  const [[tenant]] = await pool.query('SELECT company_name FROM tenants WHERE id = :tenantId', { tenantId });
  const [[dg]] = await pool.query('SELECT first_name, last_name, email FROM users WHERE id = :userId', { userId });
  try {
    const checkout = await fedapay.createCheckout(account, {
      amount: q.price,
      description: `${q.kind === 'upgrade' ? 'Passage à l\'offre' : 'Abonnement'} Africa Immo Management ${(await getPlanAsync(planKey)).label}, ${months} mois`,
      callbackUrl: `${config.frontendUrl}/abonnement/retour?ref=${reference}`,
      reference,
      customer: { name: `${dg?.first_name ?? ''} ${dg?.last_name ?? ''}`.trim() || tenant.company_name, email: dg?.email },
    });
    await pool.query('UPDATE subscription_payments SET fedapay_transaction_id = :tx WHERE id = :id', { tx: checkout.transactionId, id: ins.insertId });
    return { url: checkout.url, reference, amount: q.price, founder: q.founder, kind: q.kind, credit: q.credit };
  } catch (err) {
    await pool.query("UPDATE subscription_payments SET status = 'failed', failure_reason = 'gateway_unavailable' WHERE id = :id", { id: ins.insertId });
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
  const refundDays = (await getCatalog()).refundWindowDays;
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
    // Montée en gamme : les périodes déjà payées sont « consommées » (leur valeur est passée dans ce paiement) et ne
    // peuvent plus servir ni à un autre crédit ni à un remboursement.
    let consumed = 0;
    const upgrading = p.kind === 'upgrade' && s && s.plan_key !== p.plan_key;
    if (upgrading) {
      const [r] = await conn.query("UPDATE subscription_payments SET consumed_at = NOW() WHERE tenant_id = :t AND status = 'paid' AND consumed_at IS NULL AND period_end IS NOT NULL AND period_end > NOW()", { t: p.tenant_id });
      consumed = r.affectedRows;
    }
    const startExpr = extend ? 'current_period_end' : 'NOW()';
    await conn.query(
      `UPDATE tenant_subscriptions SET plan_key = :plan, status = 'active', period_months = :months,
         started_at = IF(:extend = 1, started_at, NOW()),
         current_period_end = DATE_ADD(${startExpr}, INTERVAL :months MONTH),
         first_purchase_at = COALESCE(first_purchase_at, IF(:first = 1, NOW(), NULL)),
         refund_eligible_until = IF(:first = 1, DATE_ADD(NOW(), INTERVAL ${Number(refundDays)} DAY), refund_eligible_until),
         founder_price = IF(:founder = 1, 1, founder_price),
         reminder_sent_for = NULL, reminder_days = NULL
       WHERE tenant_id = :t`,
      { plan: p.plan_key, months: p.months, extend: extend ? 1 : 0, first: p.is_first_purchase, founder: p.founder_price, t: p.tenant_id },
    );
    const [[after]] = await conn.query('SELECT started_at, current_period_end FROM tenant_subscriptions WHERE tenant_id = :t', { t: p.tenant_id });
    const invoice = `AIM-${new Date().getUTCFullYear()}-${String(p.id).padStart(6, '0')}`;
    await conn.query(
      "UPDATE subscription_payments SET status = 'paid', paid_at = NOW(), invoice_number = :invoice, period_start = :ps, period_end = :pe WHERE id = :id",
      { invoice, ps: extend ? null : after.started_at, pe: after.current_period_end, id: p.id },
    );
    await logEvent(conn, p.tenant_id, upgrading ? 'upgraded' : extend ? 'renewed' : 'activated', 'fedapay', { plan: p.plan_key, from: upgrading ? s.plan_key : undefined, months: p.months, amount: p.amount, credit: p.credit_applied || undefined, founder: !!p.founder_price, invoice });
    if (p.kind === 'upgrade' && Number(p.credit_applied) > 0 && consumed === 0) {
      // Le crédit avait déjà été utilisé par un autre paiement : on active (le client a payé) mais l'équipe est prévenue.
      await logEvent(conn, p.tenant_id, 'upgrade_credit_reused', 'fedapay', { paymentId: p.id, credit: p.credit_applied });
      alertAdmin(`Crédit de montée en gamme déjà utilisé (paiement ${p.id})`, [`Le paiement ${p.id} applique un crédit de ${p.credit_applied} FCFA qui n'était plus disponible.`, 'L\'abonnement a été activé. Vérifiez le dossier.']).catch(() => {});
    }
    await conn.commit();
    notifyActivation(p, after.current_period_end, extend, upgrading).catch((e) => logger.warn('Abonnement : email de confirmation non envoyé', { id: p.id, message: e.message }));
    return true;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Email de confirmation d'abonnement au DG qui a payé. Un échec d'envoi n'annule jamais l'activation. */
async function notifyActivation(p, endDate, renewal, upgrade = false) {
  const [[u]] = await pool.query(
    `SELECT u.first_name, u.email, t.company_name FROM tenants t
     LEFT JOIN users u ON u.id = :uid AND u.tenant_id = t.id WHERE t.id = :t`,
    { uid: p.created_by, t: p.tenant_id },
  );
  if (!u?.email) return;
  const plan = await getPlanAsync(p.plan_key);
  // Reçu PDF + code de vérification publique ; si la génération échoue, l'e-mail part quand même sans pièce jointe.
  let pdf; let verificationCode; let receiptNumber; let paidOn; let reference; let founder; let clientInfo;
  try {
    const [[pay]] = await pool.query('SELECT * FROM subscription_payments WHERE id = :id', { id: p.id });
    const [[client]] = await pool.query('SELECT company_name, rccm, ifu FROM tenants WHERE id = :t', { t: p.tenant_id });
    const issuance = await require('./documentIssuance').getOrCreateIssuance(p.tenant_id, 'recu_abonnement', p.id);
    verificationCode = issuance.verification_code;
    receiptNumber = pay.invoice_number;
    paidOn = new Date(pay.paid_at || Date.now()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    reference = pay.reference;
    founder = pay.founder_price;
    clientInfo = client;
    pdf = await require('./pdf').buildSubscriptionReceiptBuffer({ client, payment: pay, planLabel: plan.label, fromPlanLabel: pay.upgraded_from_plan ? (await getPlanAsync(pay.upgraded_from_plan)).label : null, verificationCode });
  } catch (e) {
    logger.warn('Abonnement : reçu PDF non généré', { id: p.id, message: e.message });
  }
  await require('./email/sendEmail').sendSubscriptionActivatedEmail({
    to: u.email,
    dgName: u.first_name,
    companyName: u.company_name,
    plan,
    months: p.months,
    amount: p.amount,
    endDate: new Date(endDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    renewal,
    upgrade,
    credit: Number(p.credit_applied) || 0,
    creditDays: p.credit_days || null,
    fromPlanLabel: p.upgraded_from_plan ? (await getPlanAsync(p.upgraded_from_plan)).label : null,
    receiptNumber,
    verificationCode,
    pdf,
    paidOn: paidOn || undefined,
    reference: reference || undefined,
    founder: !!founder,
    client: clientInfo,
  });
}

/** Alerte e-mail à l'équipe de la plateforme (anomalies de paiement). Ne lève jamais. */
async function alertAdmin(subject, paragraphs) {
  if (!config.platform.adminEmail) return;
  try {
    await require('./email/sendEmail').sendBillingEmail({
      to: config.platform.adminEmail, subject, heading: subject, paragraphs,
      linkUrl: `${config.frontendUrl}/admin`, linkLabel: 'Ouvrir le back-office',
    });
  } catch (err) {
    logger.warn('Abonnement : alerte administrateur non envoyée', { message: err.message });
  }
}

/**
 * Signale un paiement qui n'a pas abouti : trace dans le journal et un seul e-mail au directeur général (colonne
 * `failure_notified_at`). `reason` : declined | canceled | incomplete.
 */
async function notifyPaymentFailure(paymentId, reason) {
  const [r] = await pool.query('UPDATE subscription_payments SET failure_notified_at = NOW(), failure_reason = :reason WHERE id = :id AND failure_notified_at IS NULL', { id: paymentId, reason });
  if (r.affectedRows === 0) return;
  const [[p]] = await pool.query('SELECT * FROM subscription_payments WHERE id = :id', { id: paymentId });
  await logEvent(pool, p.tenant_id, reason === 'incomplete' ? 'payment_incomplete' : 'payment_failed', 'fedapay', { paymentId, reason, amount: p.amount, plan: p.plan_key });
  const [[u]] = await pool.query(
    "SELECT u.first_name, u.email FROM users u WHERE u.id = :uid OR (u.tenant_id = :t AND u.role = 'dg') ORDER BY (u.id = :uid) DESC LIMIT 1",
    { uid: p.created_by, t: p.tenant_id },
  );
  if (!u?.email) return;
  const plan = await getPlanAsync(p.plan_key);
  const incomplete = reason === 'incomplete';
  await require('./email/sendEmail').sendBillingEmail({
    to: u.email,
    subject: incomplete ? "Votre paiement n'est pas terminé" : "Votre paiement n'a pas abouti",
    heading: incomplete ? "Votre paiement n'est pas terminé" : "Votre paiement n'a pas abouti",
    paragraphs: [
      `Bonjour ${u.first_name}, le paiement de l'offre ${plan.label} (${Math.round(Number(p.amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA) ${incomplete ? "n'a pas été finalisé" : 'a été refusé ou annulé'}. Rien n'a été activé.`,
      "Vous pouvez recommencer à tout moment depuis la page Abonnement. Si votre compte Mobile Money ou votre carte a été débité, écrivez-nous avec la référence ci-dessous : nous vérifions et nous régularisons.",
      `Référence : ${p.reference}`,
    ],
    linkUrl: `${config.frontendUrl}/espace/abonnement`, linkLabel: 'Réessayer le paiement',
  });
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
    await pool.query("UPDATE subscription_payments SET status = 'failed', failure_reason = :reason WHERE id = :id AND status = 'pending'", { id: payment.id, reason: tx.status === 'declined' ? 'declined' : 'canceled' });
    await notifyPaymentFailure(payment.id, tx.status === 'declined' ? 'declined' : 'canceled').catch((e) => logger.warn('Abonnement : signalement d\'échec impossible', { id: payment.id, message: e.message }));
    return { state: 'failed' };
  }
  if (tx.status !== 'approved') return { state: 'pending' };
  if (tx.amount !== Number(payment.amount)) {
    logger.error('Abonnement : montant FedaPay différent du montant attendu', { id: payment.id });
    // Argent encaissé mais rien d'activé : anomalie à traiter à la main, l'équipe est alertée (une seule fois).
    const [r] = await pool.query("UPDATE subscription_payments SET status = 'anomaly', failure_reason = 'amount_mismatch', admin_alerted_at = NOW() WHERE id = :id AND status = 'pending'", { id: payment.id });
    if (r.affectedRows > 0) {
      await logEvent(pool, payment.tenant_id, 'payment_anomaly', 'fedapay', { paymentId: payment.id, expected: Number(payment.amount), received: tx.amount });
      alertAdmin('Paiement d\'abonnement avec un montant inattendu', [`Le paiement ${payment.reference} attendait ${payment.amount} FCFA mais FedaPay indique ${tx.amount} FCFA, statut approuvé. Rien n'a été activé.`, 'Vérifiez la transaction dans FedaPay puis activez ou remboursez le client.']).catch(() => {});
    }
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
  const plan = s.plan_key ? await getPlanAsync(s.plan_key) : null;
  // Dernière tentative de paiement non aboutie des 7 derniers jours, tant qu'aucun paiement réussi ne l'a suivie.
  const [[fail]] = await pool.query(
    `SELECT f.reference, f.plan_key, f.months, f.amount, f.failure_reason, f.status, f.created_at FROM subscription_payments f
     WHERE f.tenant_id = :tenantId AND f.status IN ('failed','anomaly') AND f.failure_reason IS NOT NULL AND f.failure_reason <> 'gateway_unavailable'
       AND f.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND NOT EXISTS (SELECT 1 FROM subscription_payments o WHERE o.tenant_id = f.tenant_id AND o.status = 'paid' AND o.id > f.id)
     ORDER BY f.id DESC LIMIT 1`,
    { tenantId },
  );
  const overLimits = active && plan && !interne ? await require('./entitlements').listOverLimits(tenantId, plan.limits) : [];
  const usage = active && plan && !interne ? await require('./entitlements').getUsage(tenantId) : null;
  return {
    overLimits,
    usage,
    planKey: s.plan_key,
    planLabel: s.plan_key ? (await getPlanAsync(s.plan_key))?.label : null,
    status: active ? 'active' : s.status === 'active' ? 'expired' : s.status,
    active,
    enforced: config.features.subscriptionsEnforced,
    periodMonths: s.period_months,
    currentPeriodEnd: interne ? null : s.current_period_end,
    daysLeft: interne || s.days_left == null ? null : Number(s.days_left),
    refundOpen: Number(s.refund_open) === 1,
    refundEligibleUntil: s.refund_eligible_until,
    founderPrice: !!s.founder_price,
    lastFailure: fail ? { reference: fail.reference, planKey: fail.plan_key, months: fail.months, amount: fail.amount, reason: fail.failure_reason, anomaly: fail.status === 'anomaly', at: fail.created_at } : null,
  };
}

module.exports = { notifyPaymentFailure, alertAdmin, upgradeOptions, confirmRow, platformAccount, verifyPlatformWebhook, findOffer, quote, publicCatalog, startCheckout, activatePayment, confirmByReference, confirmByTransaction, describe, founderTaken };
