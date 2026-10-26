'use strict';

/**
 * Paiements sortants (FedaPay) : salaires, reversements propriétaires, paiements libres.
 * Lecture : DG et comptable. Envoi d'argent : DG UNIQUEMENT, avec re-saisie du mot de passe et clé d'idempotence.
 * Aucune route ne renvoie de numéro complet, de clé secrète ni de clé d'idempotence.
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole, requireAnyPermission } = require('../middleware/auth');
// Consultation de l'historique des paiements : réservée à qui peut verser ou enregistrer des dépenses
// (avant : rôle « comptable », supprimé à la création des employés le 2026-10-26).
const canSeePayments = requireAnyPermission('reversements_proprietaires', 'depenses_enregistrer');
const { z } = require('zod');
const { createOrderSchema, listOrdersQuery, listHistoryQuery } = require('../validators/payments');
const { createOrder, refreshOrder, applyOrder, loadOrder, toPublicOrder } = require('../services/payments/orders');
const { verifyAuditChain } = require('../services/payments/audit');
const { maskPhone } = require('../services/payments/phone');
const { streamPaymentAdvicePdf } = require('../services/pdf');

const { requireFeature } = require('../services/entitlements');
const router = Router();
router.use(requireAuth, requireFeature('payouts'));

const sendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `pay:${req.user.id}`,
  message: { error: 'Trop de demandes de paiement, réessayez plus tard.' },
});

/** Validation stricte : une entrée invalide est toujours un 400 propre (jamais un 500, jamais l'écho des valeurs). */
function parseOrThrow(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors);
  return parsed.data;
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(404, 'Ordre introuvable');
  return id;
}

async function loadOwnedOrder(req) {
  const order = await loadOrder(req.user.tenantId, parseId(req.params.id));
  if (!order) throw new ApiError(404, 'Ordre introuvable');
  return order;
}

router.get('/summary', canSeePayments, async (req, res, next) => {
  try {
    const [[t]] = await pool.query(
      'SELECT fedapay_enabled, fedapay_sandbox, payments_per_order_limit, payments_daily_limit FROM tenants WHERE id = :id',
      { id: req.user.tenantId },
    );
    const [[today]] = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM payment_orders
       WHERE tenant_id = :id AND status IN ('processing','sent') AND DATE(created_at) = CURDATE()`,
      { id: req.user.tenantId },
    );
    res.json({
      enabled: !!t.fedapay_enabled,
      sandbox: !!t.fedapay_sandbox,
      perOrderLimit: Number(t.payments_per_order_limit),
      dailyLimit: Number(t.payments_daily_limit),
      sentToday: Number(today.total),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/orders', canSeePayments, async (req, res, next) => {
  try {
    const q = parseOrThrow(listOrdersQuery, req.query);
    const where = ['tenant_id = :tenantId'];
    const params = { tenantId: req.user.tenantId, limit: q.limit, offset: q.offset };
    if (q.status) { where.push('status = :status'); params.status = q.status; }
    if (q.purpose) { where.push('purpose = :purpose'); params.purpose = q.purpose; }
    if (q.from) { where.push('DATE(created_at) >= :from'); params.from = q.from; }
    if (q.to) { where.push('DATE(created_at) <= :to'); params.to = q.to; }
    const [rows] = await pool.query(
      `SELECT * FROM payment_orders WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT :limit OFFSET :offset`,
      params,
    );
    res.json({ orders: rows.map(toPublicOrder) });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id', canSeePayments, async (req, res, next) => {
  try {
    const order = await loadOwnedOrder(req);
    const [events] = await pool.query(
      `SELECT id, event_type, actor_user_id, created_at FROM payment_audit_events
       WHERE tenant_id = :tenantId AND order_id = :orderId ORDER BY id ASC`,
      { tenantId: req.user.tenantId, orderId: order.id },
    );
    res.json({
      order: toPublicOrder(order),
      timeline: events.map((e) => ({ id: e.id, event: e.event_type, at: e.created_at, byUserId: e.actor_user_id })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/orders', requireRole('dg'), sendLimiter, async (req, res, next) => {
  try {
    const input = parseOrThrow(createOrderSchema, req.body);
    const { order, replayed } = await createOrder({ user: req.user, req }, input);
    res.status(replayed ? 200 : 201).json({ order: toPublicOrder(order), replayed });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:id/refresh', canSeePayments, async (req, res, next) => {
  try {
    const order = await loadOwnedOrder(req);
    res.json({ order: toPublicOrder(await refreshOrder(req.user.tenantId, order.id, { req })) });
  } catch (err) {
    next(err);
  }
});

// Ré-application après régularisation (ex. mois rouvert) : n'a d'effet que sur un ordre `sent` non appliqué.
router.post('/orders/:id/retry-apply', requireRole('dg'), sendLimiter, async (req, res, next) => {
  try {
    const order = await loadOwnedOrder(req);
    if (order.status !== 'sent') throw new ApiError(409, "Seul un ordre dont l'envoi est confirmé peut être appliqué.");
    res.json({ order: toPublicOrder(await applyOrder(req.user.tenantId, order.id, { req })) });
  } catch (err) {
    next(err);
  }
});

router.get('/audit/verify', requireRole('dg'), async (req, res, next) => {
  try {
    res.json(await verifyAuditChain(req.user.tenantId));
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id/advice.pdf', canSeePayments, async (req, res, next) => {
  try {
    const order = await loadOwnedOrder(req);
    if (order.status !== 'sent') throw new ApiError(409, "L'avis n'est disponible qu'après confirmation de l'envoi.");
    const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :id', { id: req.user.tenantId });
    streamPaymentAdvicePdf(res, { tenant, order: { ...order, beneficiary_phone_masked: maskPhone(order.beneficiary_phone) } });
  } catch (err) {
    next(err);
  }
});

const { listPaymentHistory, KIND_LABELS } = require('../services/paymentHistory');
const { streamOperationReceiptPdf } = require('../services/pdf');

// Historique unifié (salaires visibles du seul DG : confidentiel).
router.get('/history', canSeePayments, async (req, res, next) => {
  try {
    const q = listHistoryQuery.parse(req.query);
    const kinds = q.kind ? [q.kind] : null;
    const data = await listPaymentHistory(req.user.tenantId, {
      from: q.from ?? null, to: q.to ?? null, kinds, includeSalaries: req.user.role === 'dg',
    });
    res.json(data);
  } catch (err) {
    next(err instanceof z.ZodError ? new ApiError(400, 'Filtres invalides', err.flatten().fieldErrors) : err);
  }
});

// Reçu d'une opération saisie manuellement (reversement, reversement de charges, dépense, restitution de caution).
router.get('/receipts/:kind/:id.pdf', canSeePayments, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const kind = req.params.kind;
    if (!['reversement_proprietaire', 'reversement_charges', 'depense', 'restitution_caution'].includes(kind)) throw new ApiError(404, 'Reçu introuvable');
    const { items } = await listPaymentHistory(req.user.tenantId, { kinds: [kind], includeSalaries: false });
    const found = items.find((i) => i.id === id && i.status === 'paid');
    if (!found) throw new ApiError(404, 'Opération introuvable');
    const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :id', { id: req.user.tenantId });
    streamOperationReceiptPdf(res, { tenant, op: { ...found, kindLabel: KIND_LABELS[kind] } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
