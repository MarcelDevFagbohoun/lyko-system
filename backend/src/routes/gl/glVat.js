'use strict';

/** TVA collectée sur les commissions : solde dû, rapport mensuel, règlement au fisc. */

const { Router } = require('express');
const { z } = require('zod');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { payIrfSchema } = require('../../validators/gl/irf');
const { getVatBalance, getVatReport, payVat, getVatSettings } = require('../../services/gl/glVat');
const { assertPeriodOpen } = require('../../services/accountingPeriods');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const rangeSchema = z.object({ from: z.string().regex(dateRe), to: z.string().regex(dateRe) });

router.get('/', canAdvanced, async (req, res, next) => {
  try {
    const { enabled, rate } = await getVatSettings(pool, req.user.tenantId);
    const { balance } = await getVatBalance(pool, req.user.tenantId);
    const year = new Date().getFullYear();
    const parsed = rangeSchema.safeParse({ from: req.query.from ?? `${year}-01-01`, to: req.query.to ?? `${year}-12-31` });
    if (!parsed.success) throw new ApiError(400, 'Période invalide');
    const months = await getVatReport(pool, req.user.tenantId, parsed.data);
    res.json({ enabled, rate, balanceOwed: balance, months, from: parsed.data.from, to: parsed.data.to });
  } catch (err) {
    next(err);
  }
});

router.post('/pay', canAdvanced, async (req, res, next) => {
  const parsed = payIrfSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  try {
    await assertPeriodOpen(req.user.tenantId, parsed.data.paidAt);
    const result = await payVat(pool, req.user.tenantId, { ...parsed.data, userId: req.user.id });
    res.status(201).json({ entryId: result.entryId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
