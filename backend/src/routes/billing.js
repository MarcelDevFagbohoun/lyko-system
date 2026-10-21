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
const { streamSubscriptionInvoicePdf } = require('../services/pdf');
const { getPlan } = require('../constants/plans');
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

router.use(requireAuth, requireRole('dg'));

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
      "SELECT id, plan_key, months, amount, founder_price, status, invoice_number, paid_at, period_end FROM subscription_payments WHERE tenant_id = :t AND status IN ('paid','refunded') ORDER BY id DESC LIMIT 100",
      { t: req.user.tenantId },
    );
    res.json({ payments: rows.map((r) => ({ id: r.id, planKey: r.plan_key, planLabel: getPlan(r.plan_key).label, months: r.months, amount: r.amount, founderPrice: !!r.founder_price, status: r.status, invoiceNumber: r.invoice_number, paidAt: r.paid_at, periodEnd: r.period_end })) });
  } catch (err) { next(err); }
});

router.get('/payments/:id/invoice.pdf', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ApiError(400, 'Identifiant invalide');
    const [[p]] = await pool.query("SELECT * FROM subscription_payments WHERE id = :id AND tenant_id = :t AND status IN ('paid','refunded')", { id, t: req.user.tenantId });
    if (!p) throw new ApiError(404, 'Facture introuvable');
    const [[client]] = await pool.query('SELECT company_name, rccm, ifu FROM tenants WHERE id = :t', { t: req.user.tenantId });
    streamSubscriptionInvoicePdf(res, { client, payment: p, planLabel: getPlan(p.plan_key).label });
  } catch (err) { next(err); }
});

module.exports = router;
