'use strict';

/**
 * Abonnement de l'entreprise. VOLONTAIREMENT non soumis à `requireFeature` : une entreprise dont l'abonnement a expiré
 * doit pouvoir le renouveler. Seules `plans` (catalogue public), `confirm` (retour de paiement, référence aléatoire) et
 * `webhook` (signature HMAC) sont publiques ; tout le reste exige un DG authentifié.
 */
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole } = require('../middleware/auth');
const billing = require('../services/billing');
const { paymentOutcome } = billing;
const refunds = require('../services/refunds');
const { streamSubscriptionInvoicePdf } = require('../services/pdf');
const { getOrCreateIssuance } = require('../services/documentIssuance');
const { getPlanAsync } = require('../services/planCatalog');
const logger = require('../utils/logger');

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez plus tard.' } });
const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `sub:${req.user.id}`, message: { error: 'Trop de demandes, réessayez plus tard.' } });

router.get('/plans', limiter, async (_req, res, next) => {
  try { res.json(await billing.publicCatalog()); } catch (err) { next(err); }
});

router.post('/confirm', limiter, async (req, res, next) => {
  try {
    const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim() : '';
    res.json(await billing.confirmByReference(reference));
  } catch (err) { next(err); }
});

router.post('/webhook', limiter, async (req, res) => {
  try {
    if (!billing.verifyPlatformWebhook(req.rawBody, req.get('x-fedapay-signature'))) {
      logger.warn('Webhook abonnement : signature invalide');
      return res.status(200).json({ received: true });
    }
    const id = req.body?.entity?.id;
    if ((typeof id === 'number' || typeof id === 'string') && /^\d+$/.test(String(id))) await billing.confirmByTransaction(String(id));
    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error('Webhook abonnement : échec du traitement', { error: err.message });
    return res.status(200).json({ received: true });
  }
});

// Lien reçu par courriel après validation du remboursement : informations puis saisie des coordonnées (usage unique).
router.get('/refund-link/:token', limiter, async (req, res, next) => {
  try { res.json(await refunds.tokenInfo(req.params.token)); } catch (err) { next(err); }
});
router.post('/refund-link/:token', limiter, async (req, res, next) => {
  try {
    await refunds.submitDetails(req.params.token, req.body ?? {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.use(requireAuth, requireRole('dg'));

router.post('/refund-requests', checkoutLimiter, async (req, res, next) => {
  try { res.status(201).json(await refunds.requestRefund({ tenantId: req.user.tenantId, userId: req.user.id, reason: req.body?.reason })); } catch (err) { next(err); }
});
router.get('/refund-requests', async (req, res, next) => {
  try { res.json({ refunds: await refunds.listRefunds({ tenantId: req.user.tenantId }) }); } catch (err) { next(err); }
});

router.get('/upgrade-options', async (req, res, next) => {
  try { res.json(await billing.upgradeOptions(req.user.tenantId)); } catch (err) { next(err); }
});

router.get('/subscription', async (req, res, next) => {
  try { res.json(await billing.describe(req.user.tenantId)); } catch (err) { next(err); }
});

const checkoutSchema = z.object({ planKey: z.enum(['demarrage', 'pro', 'entreprise']), months: z.number().int() });
router.post('/quote', async (req, res, next) => {
  try {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Offre invalide');
    res.json(await billing.quote(req.user.tenantId, parsed.data.planKey, parsed.data.months));
  } catch (err) { next(err); }
});

router.post('/checkout', checkoutLimiter, async (req, res, next) => {
  try {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Offre invalide');
    res.status(201).json(await billing.startCheckout({ tenantId: req.user.tenantId, userId: req.user.id, ...parsed.data }));
  } catch (err) { next(err); }
});

router.get('/payments', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, plan_key, months, kind, amount, credit_applied, credit_days, upgraded_from_plan, founder_price, status, invoice_number, paid_at, period_end, created_at FROM subscription_payments WHERE tenant_id = :t AND status IN ('paid','refunded','failed','pending','anomaly') ORDER BY id DESC LIMIT 100",
      { t: req.user.tenantId },
    );
    const labels = {};
    for (const k of new Set(rows.map((r) => r.plan_key))) labels[k] = (await getPlanAsync(k)).label;
    res.json({ payments: rows.map((r) => ({ id: r.id, planKey: r.plan_key, planLabel: labels[r.plan_key], months: r.months, kind: r.kind, amount: r.amount, creditApplied: r.credit_applied, upgradedFromPlan: r.upgraded_from_plan, founderPrice: !!r.founder_price, status: r.status, outcome: paymentOutcome(r.status, r.amount), createdAt: r.created_at, invoiceNumber: r.invoice_number, paidAt: r.paid_at, periodEnd: r.period_end })) });
  } catch (err) { next(err); }
});

router.get('/payments/:id/invoice.pdf', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ApiError(400, 'Identifiant invalide');
    const [[p]] = await pool.query("SELECT * FROM subscription_payments WHERE id = :id AND tenant_id = :t AND status IN ('paid','refunded')", { id, t: req.user.tenantId });
    if (!p) throw new ApiError(404, 'Facture introuvable');
    if (!(Number(p.amount) > 0)) throw new ApiError(404, 'Aucun reçu : cet abonnement a été offert, rien n\'a été payé.');
    const [[client]] = await pool.query('SELECT company_name, rccm, ifu FROM tenants WHERE id = :t', { t: req.user.tenantId });
    const issuance = await getOrCreateIssuance(req.user.tenantId, 'recu_abonnement', p.id); // pas de limite de téléchargements
    streamSubscriptionInvoicePdf(res, { client, payment: p, planLabel: (await getPlanAsync(p.plan_key)).label, fromPlanLabel: p.upgraded_from_plan ? (await getPlanAsync(p.upgraded_from_plan)).label : null, verificationCode: issuance.verification_code });
  } catch (err) { next(err); }
});

module.exports = router;
