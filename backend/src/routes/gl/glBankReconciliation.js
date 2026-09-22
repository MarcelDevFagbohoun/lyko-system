'use strict';

/**
 * Rapprochement bancaire (comptabilité avancée) — voir
 * `services/gl/glBankReconciliationService.js` pour la logique complète.
 * Clôturer un rapprochement est une action sensible (comme la clôture d'un
 * exercice) : journalisée dans `gl_audit_log` et notifiée au DG.
 */

const { Router } = require('express');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  startReconciliationSchema,
  updateReconciliationSchema,
  addLineSchema,
  finalizeReconciliationSchema,
} = require('../../validators/gl/bankReconciliation');
const {
  getBankJournalAndAccount,
  listReconciliations,
  startReconciliation,
  getReconciliationDetail,
  addLine,
  removeLine,
  updateStatementBalance,
  finalizeReconciliation,
} = require('../../services/gl/glBankReconciliationService');
const { logGlAudit } = require('../../services/gl/glAuditService');
const { notifyDg } = require('../../services/gl/glNotificationService');
const logger = require('../../utils/logger');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

router.get('/', canAdvanced, async (req, res, next) => {
  try {
    const reconciliations = await listReconciliations(pool, req.user.tenantId);
    res.json({ reconciliations });
  } catch (err) {
    next(err);
  }
});

router.post('/', canAdvanced, async (req, res, next) => {
  const parsed = startReconciliationSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  try {
    const { id } = await startReconciliation(pool, req.user.tenantId, parsed.data);
    logger.info('Rapprochement bancaire démarré', {
      tenantId: req.user.tenantId,
      reconciliationId: id,
      period: parsed.data.period,
      by: req.user.id,
    });
    res.status(201).json({ reconciliationId: id });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', canAdvanced, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const detail = await getReconciliationDetail(pool, req.user.tenantId, id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', canAdvanced, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = updateReconciliationSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  try {
    await updateStatementBalance(pool, req.user.tenantId, id, parsed.data.statementBalance);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post('/:id/lines', canAdvanced, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = addLineSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  try {
    const { accountId } = await getBankJournalAndAccount(pool, req.user.tenantId);
    const lineId = await addLine(pool, req.user.tenantId, id, parsed.data, accountId);
    res.status(201).json({ lineId });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/lines/:lineId', canAdvanced, async (req, res, next) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  if (!Number.isInteger(id) || !Number.isInteger(lineId)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    await removeLine(pool, req.user.tenantId, id, lineId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/gl/bank-reconciliations/:id/finalize — clôture définitive.
router.post('/:id/finalize', canAdvanced, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = finalizeReconciliationSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await finalizeReconciliation(conn, req.user.tenantId, id, { userId: req.user.id, force: parsed.data.force });

    await logGlAudit(conn, {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      ipAddress: req.ip,
      action: 'bank_reconciliation_finalized',
      entityTable: 'gl_bank_reconciliations',
      entityId: id,
    });
    await notifyDg(conn, {
      tenantId: req.user.tenantId,
      type: 'bank_reconciliation_finalized',
      message: 'Rapprochement bancaire clôturé',
      entityTable: 'gl_bank_reconciliations',
      entityId: id,
    });

    await conn.commit();
    logger.info('Rapprochement bancaire clôturé', { tenantId: req.user.tenantId, reconciliationId: id, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
