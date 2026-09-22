'use strict';

/**
 * Exercices comptables — ouverture et clôture définitive. La clôture est une
 * des 3 actions sensibles désignées explicitement par l'utilisateur : exige
 * `comptabilite_avancee`, écrit dans `gl_audit_log` et notifie le DG.
 */

const { Router } = require('express');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { createFiscalYearSchema } = require('../../validators/gl/referentiels');
const { cloturerExercice } = require('../../services/gl/glClosingService');
const { logGlAudit } = require('../../services/gl/glAuditService');
const { notifyDg } = require('../../services/gl/glNotificationService');
const logger = require('../../utils/logger');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

// mysql2 renvoie une colonne DATE comme un objet Date JS, sérialisé en JSON
// avec l'heure (ex. "2026-01-01T00:00:00.000Z") — jamais souhaité pour une
// date SANS heure ; voir le même besoin dans routes/accounting.js `isoDate`.
function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function toPublicFiscalYear(row) {
  return {
    id: row.id,
    label: row.label,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    status: row.status,
    closedAt: row.closed_at,
  };
}

router.get('/', canAdvanced, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM gl_fiscal_years WHERE tenant_id = :tenantId ORDER BY start_date DESC',
      { tenantId: req.user.tenantId },
    );
    res.json({ fiscalYears: rows.map(toPublicFiscalYear) });
  } catch (err) {
    next(err);
  }
});

// POST /api/gl/fiscal-years — ouvrir un nouvel exercice. Refuse tout
// chevauchement de dates avec un exercice existant : `resolveOpenFiscalYear`
// (moteur d'écritures) prend le PREMIER exercice couvrant une date — un
// chevauchement rendrait ce choix ambigu/imprévisible.
router.post('/', canAdvanced, async (req, res, next) => {
  const parsed = createFiscalYearSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { label, startDate, endDate } = parsed.data;
  if (startDate >= endDate) {
    return next(new ApiError(400, 'La date de fin doit être postérieure à la date de début'));
  }

  try {
    const [overlap] = await pool.query(
      `SELECT id FROM gl_fiscal_years
       WHERE tenant_id = :tenantId AND start_date <= :endDate AND end_date >= :startDate LIMIT 1`,
      { tenantId: req.user.tenantId, startDate, endDate },
    );
    if (overlap[0]) throw new ApiError(409, 'Cette période chevauche un exercice existant');

    const [result] = await pool.query(
      "INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:tenantId, :label, :startDate, :endDate, 'ouvert')",
      { tenantId: req.user.tenantId, label, startDate, endDate },
    );
    logger.info('Exercice comptable ouvert', { tenantId: req.user.tenantId, fiscalYearId: result.insertId, by: req.user.id });
    res.status(201).json({ fiscalYearId: result.insertId });
  } catch (err) {
    next(err);
  }
});

// POST /api/gl/fiscal-years/:id/close — clôture définitive.
router.post('/:id/close', canAdvanced, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await cloturerExercice(conn, { tenantId: req.user.tenantId, fiscalYearId: id, userId: req.user.id });

    await logGlAudit(conn, {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      ipAddress: req.ip,
      action: 'fiscal_year_closed',
      entityTable: 'gl_fiscal_years',
      entityId: id,
      after: result,
    });
    await notifyDg(conn, {
      tenantId: req.user.tenantId,
      type: 'fiscal_year_closed',
      message: `Exercice comptable n°${id} clôturé`,
      entityTable: 'gl_fiscal_years',
      entityId: id,
    });

    await conn.commit();
    logger.info('Exercice comptable clôturé', { tenantId: req.user.tenantId, fiscalYearId: id, by: req.user.id });
    res.json(result);
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
