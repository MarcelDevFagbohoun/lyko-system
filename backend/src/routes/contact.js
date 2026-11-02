'use strict';

/**
 * Formulaire de contact public (page d'accueil) — aucune authentification, aucun tenant : n'importe
 * qui peut écrire avant même de créer un compte. Ajouté à `OPEN_PREFIXES` (services/entitlements.js)
 * pour ne jamais passer par `enforceActiveSubscription`.
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { ApiError } = require('../middleware/error');
const { contactSchema } = require('../validators/contact');
const { sendContactFormEmail } = require('../services/email/sendEmail');
const config = require('../config/env');
const logger = require('../utils/logger');

const router = Router();

// Quota large mais borné (même principe que `registerLimiter`, routes/auth.js) : seul rempart contre
// le flood sur une route sans compte ni jeton.
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de messages envoyés, réessayez plus tard.' },
});

// POST /api/contact
router.post('/', contactLimiter, async (req, res, next) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { website, ...data } = parsed.data;

  try {
    // Piège anti-spam rempli : réponse IDENTIQUE à un envoi réussi, pour ne jamais révéler le piège
    // à un robot (qui ajusterait son comportement s'il voyait une réponse différente).
    if (website) {
      logger.warn('Message de contact ignoré (piège anti-spam rempli)', { ip: req.ip });
      return res.status(201).json({ sent: true });
    }

    if (!config.platform.adminEmail) {
      logger.warn('Message de contact reçu mais PLATFORM_ADMIN_EMAIL non configuré — perdu', { subject: data.subject });
      return res.status(201).json({ sent: true });
    }

    const result = await sendContactFormEmail({ to: config.platform.adminEmail, ...data });
    logger.info('Message de contact envoyé', { sent: result.sent, subject: data.subject });
    res.status(201).json({ sent: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
