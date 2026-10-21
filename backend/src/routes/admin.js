'use strict';

/**
 * Back-office de la plateforme Lyko System. Realm d'authentification SÉPARÉ (clé dédiée, table `platform_admins`) :
 * ni un employé ni un DG de client ne peut l'ouvrir. Aucune donnée métier des clients (locataires, loyers…) n'est
 * exposée ici — seulement l'entreprise, son abonnement, ses paiements d'abonnement et ses remboursements.
 */
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { verifyAdminToken, signAdminToken } = require('../utils/jwt');
const { verifyPassword, DUMMY_PASSWORD_HASH } = require('../utils/password');
const refunds = require('../services/refunds');
const catalogService = require('../services/planCatalog');
const { findOffer } = require('../services/billing');
const { activatePayment } = require('../services/billing');
const logger = require('../utils/logger');

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives, réessayez plus tard.' } });

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const [[a]] = await pool.query("SELECT id, name, password_hash FROM platform_admins WHERE email = :email AND status = 'active'", { email });
    const ok = await verifyPassword(password, a ? a.password_hash : DUMMY_PASSWORD_HASH);
    if (!a || !ok) throw new ApiError(401, 'Identifiants invalides');
    res.json({ token: signAdminToken({ sub: a.id }), name: a.name });
  } catch (err) { next(err); }
});

function requireAdmin(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(new ApiError(401, 'Authentification requise'));
  let payload;
  try { payload = verifyAdminToken(token); } catch { return next(new ApiError(401, 'Session invalide ou expirée')); }
  pool.query("SELECT id, name FROM platform_admins WHERE id = :id AND status = 'active'", { id: payload.sub })
    .then(([[a]]) => { if (!a) throw new ApiError(401, 'Session invalide ou expirée'); req.admin = a; next(); })
    .catch(next);
}
router.use(requireAdmin);

router.get('/me', (req, res) => res.json({ id: req.admin.id, name: req.admin.name }));

router.get('/tenants', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.company_name, t.created_at, s.plan_key, s.status, s.current_period_end, s.founder_price,
              (s.current_period_end IS NOT NULL AND s.current_period_end > NOW()) AS running,
              (SELECT COALESCE(SUM(amount),0) FROM subscription_payments p WHERE p.tenant_id = t.id AND p.status = 'paid') AS total_paid
       FROM tenants t LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id ORDER BY t.id DESC LIMIT 500`,
    );
    res.json({ tenants: rows.map((r) => ({ id: r.id, companyName: r.company_name, createdAt: r.created_at, planKey: r.plan_key, status: r.status === 'active' && r.plan_key !== 'interne' && !Number(r.running) ? 'expired' : r.status, currentPeriodEnd: r.current_period_end, founderPrice: !!r.founder_price, totalPaid: Number(r.total_paid) })) });
  } catch (err) { next(err); }
});

router.get('/refunds', async (req, res, next) => {
  try { res.json({ refunds: await refunds.listRefunds({ status: typeof req.query.status === 'string' ? req.query.status : null }) }); } catch (err) { next(err); }
});
const idOf = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id)) throw new ApiError(400, 'Identifiant invalide'); return id; };
router.post('/refunds/:id/approve', async (req, res, next) => {
  try {
    const body = z.object({ feeAmount: z.number().int().min(0).optional(), note: z.string().max(500).optional() }).safeParse(req.body ?? {});
    if (!body.success) throw new ApiError(400, 'Formulaire invalide');
    res.json(await refunds.approve({ id: idOf(req), adminId: req.admin.id, feeAmount: body.data.feeAmount ?? null, note: body.data.note ?? null }));
  } catch (err) { next(err); }
});
router.post('/refunds/:id/reject', async (req, res, next) => {
  try { await refunds.reject({ id: idOf(req), adminId: req.admin.id, note: req.body?.note }); res.json({ ok: true }); } catch (err) { next(err); }
});
router.post('/refunds/:id/pay', async (req, res, next) => {
  try { res.json(await refunds.pay({ id: idOf(req), adminId: req.admin.id })); } catch (err) { next(err); }
});
router.post('/refunds/:id/refresh', async (req, res, next) => {
  try { res.json(await refunds.refresh({ id: idOf(req) })); } catch (err) { next(err); }
});

// Offre manuelle (geste commercial, paiement hors ligne) : crée un paiement de 0 payé, tracé dans l'historique.
router.post('/tenants/:id/grant', async (req, res, next) => {
  try {
    const tenantId = idOf(req);
    const body = z.object({ planKey: z.enum(['demarrage', 'pro', 'entreprise']), months: z.number().int(), note: z.string().min(3).max(300) }).safeParse(req.body);
    if (!body.success || !(await findOffer(body.data.planKey, body.data.months))) throw new ApiError(400, 'Offre invalide');
    const [[t]] = await pool.query('SELECT id FROM tenants WHERE id = :id', { id: tenantId });
    if (!t) throw new ApiError(404, 'Entreprise introuvable');
    const [[s]] = await pool.query('SELECT plan_key FROM tenant_subscriptions WHERE tenant_id = :id', { id: tenantId });
    if (s?.plan_key === 'interne') throw new ApiError(400, 'Entreprise interne : pas d’abonnement à attribuer.');
    const reference = require('crypto').randomBytes(16).toString('hex');
    const [ins] = await pool.query("INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, amount, is_first_purchase) VALUES (:t, :r, :p, :m, 0, 0)", { t: tenantId, r: reference, p: body.data.planKey, m: body.data.months });
    await activatePayment(ins.insertId);
    await pool.query('INSERT INTO subscription_events (tenant_id, event_type, actor, details) VALUES (:t, :e, :a, :d)', { t: tenantId, e: 'granted', a: `admin:${req.admin.id}`, d: JSON.stringify({ ...body.data }) });
    logger.info('Abonnement attribué manuellement', { tenantId, admin: req.admin.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Offres : prix, durées, limites, fonctions, tarif fondateur, délai de remboursement. Les prix ne touchent que les achats futurs.
router.get('/catalog', async (_req, res, next) => {
  try { res.json({ catalog: await catalogService.getCatalog(), features: catalogService.FEATURES.filter((f) => f !== 'ai_assistant'), changes: await catalogService.listChanges() }); } catch (err) { next(err); }
});
router.put('/catalog', async (req, res, next) => {
  try {
    const catalog = await catalogService.saveCatalog(req.admin.id, req.body);
    logger.info('Catalogue des offres modifié', { admin: req.admin.id });
    res.json({ catalog });
  } catch (err) { next(err); }
});
router.post('/catalog/reset', async (req, res, next) => {
  try { res.json({ catalog: await catalogService.resetCatalog(req.admin.id) }); } catch (err) { next(err); }
});

module.exports = router;
