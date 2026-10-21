'use strict';

/**
 * Routes PUBLIQUES de l'encaissement FedaPay : retour du client après paiement + webhook.
 * Aucune n'est digne de confiance : chacune ne sert qu'à DÉCLENCHER une relecture serveur de la transaction.
 */
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const fedapay = require('../services/payments/fedapay');
const { confirmByReference, confirmByTransaction } = require('../services/onlinePayments');
const logger = require('../utils/logger');

const router = Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});

// POST /api/online-payments/confirm { reference } — appelée par la page de retour.
router.post('/online-payments/confirm', limiter, async (req, res, next) => {
  try {
    const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim() : '';
    res.json(await confirmByReference(reference));
  } catch (err) {
    next(err);
  }
});

// POST /api/webhooks/fedapay/:tenantId — signature HMAC obligatoire ; ne crédite rien directement.
router.post('/webhooks/fedapay/:tenantId', limiter, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) return res.status(200).json({ received: true });
    const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });
    if (!tenant || !fedapay.verifyWebhookSignature(tenant, req.rawBody, req.get('x-fedapay-signature'))) {
      logger.warn('Webhook FedaPay : signature invalide', { tenantId });
      return res.status(200).json({ received: true });
    }
    const entity = req.body?.entity;
    const id = typeof entity?.id === 'number' || typeof entity?.id === 'string' ? String(entity.id).slice(0, 64) : null;
    if (id && /^\d+$/.test(id)) await confirmByTransaction(tenantId, id);
    return res.status(200).json({ received: true });
  } catch (err) {
    // Jamais de 5xx pour un souci métier : le prestataire réessaierait sans fin. Journalisé uniquement.
    logger.error('Webhook FedaPay : échec du traitement', { error: err.message });
    return res.status(200).json({ received: true });
  }
});

module.exports = router;
