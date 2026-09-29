'use strict';

// Assistant IA (chat Claude) — étape A. Toutes les routes exigent une session employé ; l'accès à
// l'assistant lui-même est vérifié à chaque appel (activation par la direction, permission, clé, quota).

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');
const { isConfigured } = require('../services/assistant/client');
const { getStatus, loadContext, assertCanChat, blockReason } = require('../services/assistant/access');
const { getUsageSummary } = require('../services/assistant/usage');
const { runChat } = require('../services/assistant/chat');
const { listConversations, getConversation, deleteConversation } = require('../services/assistant/conversations');
const { saveProfile, deleteProfile } = require('../services/assistant/profile');
const config = require('../config/env');

const router = Router();
router.use(requireAuth);

// Cadence par utilisateur (et non par adresse IP : plusieurs employés partagent souvent la même connexion).
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `assistant:${req.user.tenantId}:${req.user.id}`,
  message: { error: 'Trop de messages, patientez un instant.' },
});

const chatSchema = z.object({
  message: z.string().trim().min(1, 'Message vide').max(2000, 'Message trop long (2000 caractères maximum)'),
  conversationId: z.coerce.number().int().positive().optional(),
});

const settingsSchema = z.object({
  enabled: z.boolean(),
  // Confirmation explicite requise pour ACTIVER (voir le gestionnaire) : les données envoyées à
  // l'assistant quittent la plateforme.
  acknowledge: z.boolean().optional(),
  monthlyQuota: z.coerce.number().int().min(0).max(100000).optional(),
});

const profileSchema = z.object({
  displayName: z.string().max(200),
  jobTitle: z.string().max(200),
});

const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Identifiant invalide');
  return id;
};

// GET /api/assistant/status — l'assistant est-il utilisable par CET utilisateur ? (affiche ou masque le bouton)
router.get('/status', async (req, res, next) => {
  try {
    res.json(await getStatus(req.user));
  } catch (err) {
    next(err);
  }
});

// GET /api/assistant/settings — réglages du cabinet (direction).
router.get('/settings', requireRole('dg'), async (req, res, next) => {
  try {
    const ctx = await loadContext(req.user);
    const usage = await getUsageSummary(req.user.tenantId);
    res.json({
      enabled: ctx.enabled,
      consentAt: ctx.consentAt,
      keyConfigured: isConfigured(),
      model: config.ai.model,
      retentionDays: config.ai.retentionDays,
      usage,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/assistant/settings — activer / désactiver, régler le quota (direction).
router.put('/settings', requireRole('dg'), async (req, res, next) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const { enabled, monthlyQuota } = parsed.data;
  try {
    const [[before]] = await pool.query('SELECT assistant_enabled FROM tenants WHERE id = :id LIMIT 1', { id: req.user.tenantId });
    const activating = enabled && !before.assistant_enabled;
    if (activating && parsed.data.acknowledge !== true) {
      throw new ApiError(400, 'Formulaire invalide', {
        acknowledge: ["Vous devez confirmer avoir pris connaissance de l'information avant d'activer l'assistant"],
      });
    }
    const fields = ['assistant_enabled = :enabled'];
    const params = { id: req.user.tenantId, enabled: enabled ? 1 : 0 };
    if (activating) {
      // Consentement daté et attribué, conservé tant que l'assistant est actif.
      fields.push('assistant_consent_at = NOW()', 'assistant_consent_by = :by');
      params.by = req.user.id;
    }
    if (monthlyQuota !== undefined) {
      fields.push('assistant_monthly_quota = :quota');
      params.quota = monthlyQuota;
    }
    await pool.query(`UPDATE tenants SET ${fields.join(', ')} WHERE id = :id`, params);
    logger.info('Assistant IA : réglage modifié', { tenantId: req.user.tenantId, by: req.user.id, enabled });
    const ctx = await loadContext(req.user);
    res.json({ enabled: ctx.enabled, consentAt: ctx.consentAt, usage: await getUsageSummary(req.user.tenantId) });
  } catch (err) {
    next(err);
  }
});

// POST /api/assistant/chat — un tour de conversation, en flux continu (Server-Sent Events).
router.post('/chat', chatLimiter, async (req, res, next) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Message invalide', parsed.error.flatten().fieldErrors));

  // Droits, clé ET quota sont vérifiés AVANT d'ouvrir le flux : ils doivent produire une vraie erreur HTTP
  // (403 / 429 / 503), pas un message d'erreur noyé dans un flux déjà commencé.
  try {
    await assertCanChat(await loadContext(req.user));
  } catch (err) {
    return next(err);
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // pas de mise en tampon par un reverse-proxy
  });
  res.flushHeaders();

  const send = (event) => {
    if (!res.writableEnded) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  // Battement régulier : un proxy coupe volontiers une connexion silencieuse pendant que le modèle réfléchit.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    await runChat({
      auth: req.user,
      message: parsed.data.message,
      conversationId: parsed.data.conversationId ?? null,
      emit: send,
      signal: controller.signal,
    });
  } catch (err) {
    send({ type: 'error', message: err.message, status: err.status ?? 500 });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

// Profil mémorisé (nom d'usage + fonction) : privé à l'utilisateur, conservé jusqu'à ce qu'il l'efface.
async function requireAssistantAccess(req) {
  const ctx = await loadContext(req.user);
  const reason = blockReason(ctx);
  if (reason) throw new ApiError(reason === 'not_configured' ? 503 : 403, "Vous n'avez pas accès à l'assistant.");
  return ctx;
}

router.put('/profile', async (req, res, next) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Profil invalide', parsed.error.flatten().fieldErrors));
  try {
    await requireAssistantAccess(req);
    res.json({ profile: await saveProfile(req.user.tenantId, req.user.id, parsed.data) });
  } catch (err) {
    next(err);
  }
});

router.delete('/profile', async (req, res, next) => {
  try {
    await requireAssistantAccess(req);
    await deleteProfile(req.user.tenantId, req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Conversations — privées à leur auteur.
router.get('/conversations', async (req, res, next) => {
  try {
    res.json({ conversations: await listConversations(req.user.tenantId, req.user.id) });
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conversation = await getConversation(req.user.tenantId, req.user.id, idParam(req));
    if (!conversation) throw new ApiError(404, 'Conversation introuvable');
    res.json({ conversation });
  } catch (err) {
    next(err);
  }
});

router.delete('/conversations/:id', async (req, res, next) => {
  try {
    const deleted = await deleteConversation(req.user.tenantId, req.user.id, idParam(req));
    if (!deleted) throw new ApiError(404, 'Conversation introuvable');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
