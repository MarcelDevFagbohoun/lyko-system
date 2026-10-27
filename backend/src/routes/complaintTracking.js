'use strict';

// Page de suivi d'une plainte pour le locataire — PUBLIQUE, sans compte : le jeton propre à la plainte est le seul
// secret. Il ne donne accès qu'à cette plainte : ses événements visibles du locataire et la possibilité de répondre.

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { ApiError } = require('../middleware/error');
const { tenantCommentSchema } = require('../validators/complaints');
const { getTrackingView, addTenantComment } = require('../services/complaintEvents');
const logger = require('../utils/logger');

const router = Router();

const trackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});
router.use(trackingLimiter);

// GET /api/complaint-tracking/:token
router.get('/:token', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getTrackingView(req.params.token));
  } catch (err) {
    next(err);
  }
});

// POST /api/complaint-tracking/:token/comments { message }
router.post('/:token/comments', async (req, res, next) => {
  const parsed = tenantCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Message invalide', parsed.error.flatten().fieldErrors));
  }
  try {
    await addTenantComment(req.params.token, parsed.data.message);
    logger.info('Réponse du locataire sur une plainte');
    res.set('Cache-Control', 'no-store');
    res.status(201).json(await getTrackingView(req.params.token));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
