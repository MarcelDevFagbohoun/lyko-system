'use strict';

/**
 * IRF (Impôt sur le Revenu Foncier, hypothèse #10 — À VALIDER) — voir
 * services/gl/glIrfService.js pour la logique complète. Ouvert au DG ET au
 * comptable autorisé (`comptabilite_avancee`), comme les autres écritures
 * de règlement (fournisseur, immobilisation).
 */

const { Router } = require('express');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { payIrfSchema } = require('../../validators/gl/irf');
const { getIrfBalance, payIrf } = require('../../services/gl/glIrfService');
const { assertPeriodOpen } = require('../../services/accountingPeriods');
const logger = require('../../utils/logger');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

router.get('/', canAdvanced, async (req, res, next) => {
  try {
    const balanceOwed = await getIrfBalance(pool, req.user.tenantId);
    res.json({ balanceOwed });
  } catch (err) {
    next(err);
  }
});

router.post('/pay', canAdvanced, async (req, res, next) => {
  const parsed = payIrfSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { amount, paymentMethod, paidAt } = parsed.data;

  try {
    await assertPeriodOpen(req.user.tenantId, paidAt);
    const result = await payIrf(pool, req.user.tenantId, { amount, paymentMethod, paidAt, userId: req.user.id });
    logger.info('IRF reversé au fisc', { tenantId: req.user.tenantId, amount, entryId: result.entryId, by: req.user.id });
    res.status(201).json({ entryId: result.entryId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
