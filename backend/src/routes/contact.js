'use strict';

/**
 * Formulaire de contact public (page d'accueil) — aucune authentification, aucun tenant : n'importe
 * qui peut écrire avant même de créer un compte. Ajouté à `OPEN_PREFIXES` (services/entitlements.js)
 * pour ne jamais passer par `enforceActiveSubscription`.
 *
 * Chaque message est enregistré dans `contact_messages` : c'est la source de vérité, lue par le
 * back-office plateforme (routes/admin.js, onglet « Messages »). L'e-mail n'est qu'une notification
 * best-effort en plus — si Resend est indisponible ou mal configuré, le message reste visible dans
 * le back-office.
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
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
    // à un robot (qui ajusterait son comportement s'il voyait une réponse différente). Rien n'est
    // enregistré dans le back-office pour ce cas.
    if (website) {
      logger.warn('Message de contact ignoré (piège anti-spam rempli)', { ip: req.ip });
      return res.status(201).json({ sent: true });
    }

    await pool.query(
      `INSERT INTO contact_messages (first_name, last_name, company_name, phone, subject, description)
       VALUES (:firstName, :lastName, :companyName, :phone, :subject, :description)`,
      {
        firstName: data.firstName,
        lastName: data.lastName,
        companyName: data.companyName ?? null,
        phone: data.phone,
        subject: data.subject,
        description: data.description,
      },
    );

    // Notification e-mail best-effort : un échec ici (Resend non configuré, en panne…) n'empêche
    // jamais la réponse de succès — le message est déjà dans le back-office.
    if (config.platform.adminEmail) {
      const result = await sendContactFormEmail({ to: config.platform.adminEmail, ...data }).catch((err) => {
        logger.warn('E-mail de notification de contact non envoyé', { message: err.message });
        return { sent: false };
      });
      logger.info('Message de contact enregistré', { emailed: result.sent, subject: data.subject });
    } else {
      logger.info('Message de contact enregistré (PLATFORM_ADMIN_EMAIL non configuré, pas d’e-mail)', { subject: data.subject });
    }

    res.status(201).json({ sent: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
