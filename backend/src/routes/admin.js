'use strict';

/**
 * Back-office de la plateforme Africa Immo Management. Realm d'authentification SÉPARÉ (clé dédiée, table `platform_admins`) :
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
const { findOffer, paymentOutcome } = require('../services/billing');
const { activatePayment } = require('../services/billing');
const logger = require('../utils/logger');
const totp = require('../services/totp');
const { encryptSecret, decryptSecret } = require('../utils/encryption');

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives, réessayez plus tard.' } });

/** Journal d'audit des actions d'administration (jamais bloquant : une panne de journal n'empêche pas l'action). */
async function audit(req, action, target = null, details = null, who = null) {
  try {
    const a = who || req.admin || {};
    await pool.query(
      'INSERT INTO platform_admin_audit (admin_id, admin_email, action, target, details, ip) VALUES (:id, :email, :action, :target, :details, :ip)',
      { id: a.id ?? null, email: a.email ?? null, action, target, details: details ? JSON.stringify(details) : null, ip: req.ip ?? null },
    );
  } catch (err) {
    logger.warn('Journal d’audit admin : écriture impossible', { message: err.message });
  }
}

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const [[a]] = await pool.query("SELECT id, email, name, password_hash, totp_enabled, totp_secret_enc, totp_last_step FROM platform_admins WHERE email = :email AND status = 'active'", { email });
    const ok = await verifyPassword(password, a ? a.password_hash : DUMMY_PASSWORD_HASH);
    if (!a || !ok) {
      await audit(req, 'login_failed', email.slice(0, 80), null, { id: a?.id ?? null, email });
      throw new ApiError(401, 'Identifiants invalides');
    }
    if (a.totp_enabled) {
      const code = req.body?.code;
      if (!code) throw new ApiError(401, 'Code de vérification requis', { code: 'TOTP_REQUIRED' });
      const step = totp.verifyCode(decryptSecret(a.totp_secret_enc), code);
      // Un code déjà utilisé (pas <= dernier pas accepté) est refusé : pas de rejeu.
      if (step === null || (a.totp_last_step !== null && step <= Number(a.totp_last_step))) {
        await audit(req, 'login_2fa_failed', email.slice(0, 80), null, { id: a.id, email });
        throw new ApiError(401, 'Code de vérification invalide', { code: 'TOTP_INVALID' });
      }
      await pool.query('UPDATE platform_admins SET totp_last_step = :s WHERE id = :id', { s: step, id: a.id });
    }
    await audit(req, 'login', null, { twoFactor: !!a.totp_enabled }, { id: a.id, email: a.email });
    res.json({ token: signAdminToken({ sub: a.id }), name: a.name, twoFactor: !!a.totp_enabled });
  } catch (err) { next(err); }
});

function requireAdmin(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(new ApiError(401, 'Authentification requise'));
  let payload;
  try { payload = verifyAdminToken(token); } catch { return next(new ApiError(401, 'Session invalide ou expirée')); }
  pool.query("SELECT id, email, name, totp_enabled FROM platform_admins WHERE id = :id AND status = 'active'", { id: payload.sub })
    .then(([[a]]) => { if (!a) throw new ApiError(401, 'Session invalide ou expirée'); req.admin = a; next(); })
    .catch(next);
}
router.use(requireAdmin);

router.get('/me', (req, res) => res.json({ id: req.admin.id, name: req.admin.name, twoFactor: !!req.admin.totp_enabled }));

// Double authentification : (1) setup renvoie le secret à scanner, (2) enable le confirme avec un 1er code, (3) disable exige mot de passe + code.
router.post('/2fa/setup', async (req, res, next) => {
  try {
    if (req.admin.totp_enabled) throw new ApiError(400, 'La double authentification est déjà active.');
    const secret = totp.generateSecret();
    await pool.query('UPDATE platform_admins SET totp_secret_enc = :s, totp_enabled = 0, totp_last_step = NULL WHERE id = :id', { s: encryptSecret(secret), id: req.admin.id });
    res.json({ secret, uri: totp.otpauthUri(secret, req.admin.email) });
  } catch (err) { next(err); }
});
router.post('/2fa/enable', async (req, res, next) => {
  try {
    const [[a]] = await pool.query('SELECT totp_secret_enc, totp_enabled FROM platform_admins WHERE id = :id', { id: req.admin.id });
    if (!a.totp_secret_enc || a.totp_enabled) throw new ApiError(400, 'Lancez d’abord la configuration.');
    const step = totp.verifyCode(decryptSecret(a.totp_secret_enc), req.body?.code);
    if (step === null) throw new ApiError(400, 'Code invalide. Vérifiez l’heure de votre téléphone.');
    await pool.query('UPDATE platform_admins SET totp_enabled = 1, totp_last_step = :s WHERE id = :id', { s: step, id: req.admin.id });
    await audit(req, '2fa_enabled');
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.post('/2fa/disable', async (req, res, next) => {
  try {
    const [[a]] = await pool.query('SELECT password_hash, totp_secret_enc, totp_enabled, totp_last_step FROM platform_admins WHERE id = :id', { id: req.admin.id });
    if (!a.totp_enabled) throw new ApiError(400, 'La double authentification n’est pas active.');
    const okPwd = await verifyPassword(String(req.body?.password ?? ''), a.password_hash);
    const step = totp.verifyCode(decryptSecret(a.totp_secret_enc), req.body?.code);
    if (!okPwd || step === null || (a.totp_last_step !== null && step <= Number(a.totp_last_step))) throw new ApiError(400, 'Mot de passe ou code invalide.');
    await pool.query('UPDATE platform_admins SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = NULL WHERE id = :id', { id: req.admin.id });
    await audit(req, '2fa_disabled');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/audit', async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, admin_email, action, target, details, ip, created_at FROM platform_admin_audit ORDER BY id DESC LIMIT 200');
    res.json({ entries: rows.map((r) => ({ id: r.id, adminEmail: r.admin_email, action: r.action, target: r.target, details: r.details, ip: r.ip, createdAt: r.created_at })) });
  } catch (err) { next(err); }
});

router.get('/tenants', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.company_name, t.created_at, s.plan_key, s.status, s.current_period_end, s.founder_price,
              (s.current_period_end IS NOT NULL AND s.current_period_end > NOW()) AS running,
              (SELECT COALESCE(SUM(amount),0) FROM subscription_payments p WHERE p.tenant_id = t.id AND p.status = 'paid') AS total_paid,
              (SELECT p2.status FROM subscription_payments p2 WHERE p2.tenant_id = t.id ORDER BY p2.id DESC LIMIT 1) AS last_payment_status,
              (SELECT COUNT(*) FROM property_units pu WHERE pu.tenant_id = t.id) AS n_units,
              (SELECT COUNT(*) FROM owners o WHERE o.tenant_id = t.id AND o.mandate_ended_at IS NULL) AS n_owners,
              (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.status = 'active') AS n_users
       FROM tenants t LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id ORDER BY t.id DESC LIMIT 500`,
    );
    const catalog = await catalogService.getCatalog();
    const over = (r) => {
      const lim = catalog.plans?.[r.plan_key]?.limits;
      if (!lim || r.plan_key === 'interne') return [];
      return [['units', 'n_units', 'unités'], ['owners', 'n_owners', 'propriétaires'], ['users', 'n_users', 'utilisateurs']]
        .filter(([k, c]) => lim[k] !== null && lim[k] !== undefined && Number(r[c]) > lim[k])
        .map(([k, c, label]) => `${r[c]} ${label} (max ${lim[k]})`);
    };
    res.json({ tenants: rows.map((r) => ({ overLimits: over(r), id: r.id, companyName: r.company_name, createdAt: r.created_at, planKey: r.plan_key, status: r.status === 'active' && r.plan_key !== 'interne' && !Number(r.running) ? 'expired' : r.status, currentPeriodEnd: r.current_period_end, founderPrice: !!r.founder_price, totalPaid: Number(r.total_paid), lastPayment: r.last_payment_status ? paymentOutcome(r.last_payment_status) : null })) });
  } catch (err) { next(err); }
});

router.get('/payment-issues', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.reference, p.status, p.failure_reason, p.plan_key, p.months, p.kind, p.amount, p.credit_applied, p.created_at, t.company_name
       FROM subscription_payments p JOIN tenants t ON t.id = p.tenant_id
       WHERE (p.status = 'anomaly' OR (p.status = 'failed' AND p.failure_reason IS NOT NULL AND p.failure_reason <> 'gateway_unavailable') OR (p.status = 'pending' AND p.created_at <= DATE_SUB(NOW(), INTERVAL 2 HOUR)))
         AND p.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
       ORDER BY (p.status = 'anomaly') DESC, p.id DESC LIMIT 200`,
    );
    res.json({ issues: rows.map((r) => ({ id: r.id, reference: r.reference, status: r.status, reason: r.failure_reason, planKey: r.plan_key, months: r.months, kind: r.kind, amount: r.amount, creditApplied: r.credit_applied, createdAt: r.created_at, companyName: r.company_name })) });
  } catch (err) { next(err); }
});

router.get('/refunds', async (req, res, next) => {
  try { res.json({ refunds: await refunds.listRefunds({ status: typeof req.query.status === 'string' ? req.query.status : null, full: true }) }); } catch (err) { next(err); }
});
const idOf = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id)) throw new ApiError(400, 'Identifiant invalide'); return id; };
router.post('/refunds/:id/approve', async (req, res, next) => {
  try {
    const body = z.object({ feeAmount: z.number().int().min(0).optional(), note: z.string().max(500).optional() }).safeParse(req.body ?? {});
    if (!body.success) throw new ApiError(400, 'Formulaire invalide');
    const out = await refunds.approve({ id: idOf(req), adminId: req.admin.id, feeAmount: body.data.feeAmount ?? null, note: body.data.note ?? null });
    await audit(req, 'refund_approve', `refund:${req.params.id}`, { feeAmount: body.data.feeAmount ?? null });
    res.json(out);
  } catch (err) { next(err); }
});
router.post('/refunds/:id/reject', async (req, res, next) => {
  try { await refunds.reject({ id: idOf(req), adminId: req.admin.id, note: req.body?.note }); await audit(req, 'refund_reject', `refund:${req.params.id}`, { note: req.body?.note ?? null }); res.json({ ok: true }); } catch (err) { next(err); }
});
router.post('/refunds/:id/pay', async (req, res, next) => {
  try { const out = await refunds.pay({ id: idOf(req), adminId: req.admin.id }); await audit(req, 'refund_pay', `refund:${req.params.id}`, out); res.json(out); } catch (err) { next(err); }
});
router.post('/refunds/:id/mark-paid', async (req, res, next) => {
  try { const out = await refunds.markPaidManually({ id: idOf(req), adminId: req.admin.id, reference: req.body?.reference }); await audit(req, 'refund_mark_paid', `refund:${req.params.id}`, { reference: req.body?.reference ?? null }); res.json(out); } catch (err) { next(err); }
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
    // Une entreprise « interne » peut devenir cliente payante : l'attribution remplace l'offre interne par l'offre choisie.
    const reference = require('crypto').randomBytes(16).toString('hex');
    const [ins] = await pool.query("INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, amount, is_first_purchase) VALUES (:t, :r, :p, :m, 0, 0)", { t: tenantId, r: reference, p: body.data.planKey, m: body.data.months });
    await activatePayment(ins.insertId);
    await pool.query('INSERT INTO subscription_events (tenant_id, event_type, actor, details) VALUES (:t, :e, :a, :d)', { t: tenantId, e: 'granted', a: `admin:${req.admin.id}`, d: JSON.stringify({ ...body.data }) });
    logger.info('Abonnement attribué manuellement', { tenantId, admin: req.admin.id });
    await audit(req, 'tenant_grant', `tenant:${tenantId}`, body.data);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Remet une entreprise en offre « interne » (accès complet, sans limite ni échéance) — équipe, démonstration, partenaire.
router.post('/tenants/:id/internal', async (req, res, next) => {
  try {
    const tenantId = idOf(req);
    const note = String(req.body?.note ?? '').trim();
    if (note.length < 3) throw new ApiError(400, 'Indiquez le motif.');
    const [[t]] = await pool.query('SELECT id FROM tenants WHERE id = :id', { id: tenantId });
    if (!t) throw new ApiError(404, 'Entreprise introuvable');
    await pool.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_key, status) VALUES (:t, 'interne', 'active')
       ON DUPLICATE KEY UPDATE plan_key = 'interne', status = 'active', current_period_end = NULL, period_months = NULL`,
      { t: tenantId },
    );
    await pool.query('INSERT INTO subscription_events (tenant_id, event_type, actor, details) VALUES (:t, :e, :a, :d)', { t: tenantId, e: 'set_internal', a: `admin:${req.admin.id}`, d: JSON.stringify({ note }) });
    await audit(req, 'tenant_set_internal', `tenant:${tenantId}`, { note });
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
    await audit(req, 'catalog_save');
    res.json({ catalog });
  } catch (err) { next(err); }
});
router.post('/catalog/reset', async (req, res, next) => {
  try { const catalog = await catalogService.resetCatalog(req.admin.id); await audit(req, 'catalog_reset'); res.json({ catalog }); } catch (err) { next(err); }
});

module.exports = router;
