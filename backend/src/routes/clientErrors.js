'use strict';

/**
 * Signalement d'un écran en erreur par le navigateur (suivi des erreurs, demande utilisateur
 * 2026-11-13) : quand une page plante chez un utilisateur, le frontend envoie ici le message
 * technique pour qu'il apparaisse dans le back-office (onglet « Erreurs ») — sinon ces pannes
 * n'existent que sur l'écran de la personne concernée.
 *
 * Route publique (une page peut planter avant toute connexion) : quota serré par adresse IP,
 * tailles bornées, plafond global d'erreurs navigateur ouvertes (services/errorTracker.js). Le
 * jeton d'accès, s'il est fourni et valide, sert uniquement à savoir quelle entreprise est touchée.
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { verifyAccessToken } = require('../utils/jwt');
const { recordError, normalizePath } = require('../services/errorTracker');

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de signalements.' },
});

const schema = z.object({
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(8000).optional(),
  page: z.string().max(300).optional(),
});

// POST /api/client-errors — répond toujours 204 : le navigateur n'a rien à faire du résultat.
router.post('/', limiter, async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (parsed.success) {
    let user = null;
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Bearer' && token) {
      try { user = verifyAccessToken(token); } catch (_e) { /* session expirée : signalement anonyme */ }
    }
    await recordError({
      kind: 'frontend',
      error: { message: parsed.data.message, stack: parsed.data.stack },
      location: parsed.data.page ? normalizePath(parsed.data.page) : null,
      tenantId: user?.tenantId ?? null,
      userId: user?.sub ?? null,
    });
  }
  res.status(204).end();
});

module.exports = router;
