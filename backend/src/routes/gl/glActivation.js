'use strict';

/**
 * Activation / suspension de la comptabilité avancée (SYSCOHADA) — décision
 * explicite de l'utilisateur : les deux modes de comptabilité (simple et
 * avancée) coexistent sur la plateforme, chaque entreprise choisit et peut
 * migrer de l'un à l'autre sans jamais perdre de données. Réservé au DG
 * (`requireRole('dg')`, pas seulement `comptabilite_avancee`) : c'est un
 * choix structurant pour l'entreprise entière, pas une tâche de saisie.
 */

const { Router } = require('express');
const { pool } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const {
  isInitialized,
  findEarliestOperationDate,
  activateModule,
  deactivateModule,
} = require('../../services/gl/glActivationService');
const logger = require('../../utils/logger');

const router = Router();
router.use(requireAuth);
router.use(requireRole('dg'));

// GET /api/gl/activation/status
router.get('/status', async (req, res, next) => {
  try {
    const [[tenantRow]] = await pool.query('SELECT gl_module_enabled, accounting_start_date FROM tenants WHERE id = :id', {
      id: req.user.tenantId,
    });
    const initialized = await isInitialized(pool, req.user.tenantId);
    const earliestOperation = initialized ? null : await findEarliestOperationDate(pool, req.user.tenantId);
    res.json({
      initialized,
      enabled: !!tenantRow.gl_module_enabled,
      earliestOperation,
      accountingStartDate: tenantRow.accounting_start_date
        ? (tenantRow.accounting_start_date instanceof Date
            ? tenantRow.accounting_start_date.toISOString().slice(0, 10)
            : String(tenantRow.accounting_start_date).slice(0, 10))
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/gl/activation/activate
router.post('/activate', async (req, res, next) => {
  try {
    const result = await activateModule(pool, req.user.tenantId, { userId: req.user.id, ipAddress: req.ip });
    logger.info('Comptabilité avancée activée', {
      tenantId: req.user.tenantId,
      by: req.user.id,
      entriesGenerated: result.entriesGenerated,
      errors: result.errors.length,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/gl/activation/deactivate
router.post('/deactivate', async (req, res, next) => {
  try {
    await deactivateModule(pool, req.user.tenantId, { userId: req.user.id, ipAddress: req.ip });
    logger.info('Comptabilité avancée suspendue', { tenantId: req.user.tenantId, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
