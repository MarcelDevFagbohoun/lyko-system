'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { payIrfSchema } = require('../../validators/gl/irf');
const { getPayrollLiabilities, payLiability } = require('../../services/gl/glLiabilityService');
const { assertPeriodOpen } = require('../../services/accountingPeriods');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

router.get('/', canAdvanced, async (req, res, next) => {
  try {
    res.json(await getPayrollLiabilities(pool, req.user.tenantId));
  } catch (err) {
    next(err);
  }
});

router.post('/pay', canAdvanced, async (req, res, next) => {
  const parsed = payIrfSchema.extend({ kind: z.enum(['cnss', 'its']) }).safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  try {
    await assertPeriodOpen(req.user.tenantId, parsed.data.paidAt);
    const { kind, ...rest } = parsed.data;
    const result = await payLiability(pool, req.user.tenantId, kind, { ...rest, userId: req.user.id });
    res.status(201).json({ entryId: result.entryId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
