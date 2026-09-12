'use strict';

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');
const { createChargeSchema, updateChargeSchema, payChargeSchema, deleteReasonSchema } = require('../validators/charges');
const { UTILITY_TYPES, CHARGE_STATUSES } = require('../constants/charges');
const { toActor } = require('../utils/actor');
const { assertPeriodOpen } = require('../services/accountingPeriods');
const logger = require('../utils/logger');

const router = Router();
// Catalogue de permissions dédié depuis l'étape 3 (`charges`, par défaut
// comptable) — module financier propre aux fluides, distinct de locataires
// ET de comptabilite.
router.use(requireAuth, requirePermission('charges'));

const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
};

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function toPublicCharge(row) {
  return {
    id: row.id,
    utilityType: row.utility_type,
    periodStart: isoDate(row.period_start),
    periodEnd: isoDate(row.period_end),
    readingStart: row.reading_start,
    readingEnd: row.reading_end,
    consumption: row.reading_end - row.reading_start,
    unitPrice: Number(row.unit_price),
    amount: Number(row.amount),
    billedAt: isoDate(row.billed_at),
    status: row.status,
    paidAt: isoDate(row.paid_at),
    paymentMethod: row.payment_method,
    paymentMethodLabel: row.payment_method ? PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method : null,
    notes: row.notes,
    recordedBy: toActor(row.recorder_first_name, row.recorder_last_name, row.recorder_role),
    paidRecordedBy: toActor(row.payer_first_name, row.payer_last_name, row.payer_role),
    lease: { id: row.lease_id, status: row.lease_status },
    renter: { id: row.renter_id, firstName: row.renter_first_name, lastName: row.renter_last_name },
    unit: { id: row.unit_id, code: row.unit_code },
    property: { id: row.property_id, code: row.property_code },
    createdAt: row.created_at,
  };
}

const CHARGE_SELECT = `
  uc.*,
  l.status AS lease_status,
  r.id AS renter_id, r.first_name AS renter_first_name, r.last_name AS renter_last_name,
  u.id AS unit_id, u.code AS unit_code,
  p.id AS property_id, p.code AS property_code,
  ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name, ru.role AS recorder_role,
  pu.first_name AS payer_first_name, pu.last_name AS payer_last_name, pu.role AS payer_role
`;
const CHARGE_JOINS = `
  FROM utility_charges uc
  JOIN leases l ON l.id = uc.lease_id
  JOIN renters r ON r.id = l.renter_id
  JOIN property_units u ON u.id = l.unit_id
  JOIN properties p ON p.id = u.property_id
  LEFT JOIN users ru ON ru.id = uc.recorded_by
  LEFT JOIN users pu ON pu.id = uc.paid_recorded_by
`;

/** Charge un bail actif de l'entreprise courante, ou lève une erreur explicite. */
async function loadActiveLease(conn, tenantId, leaseId) {
  const [rows] = await conn.query(
    'SELECT * FROM leases WHERE id = :leaseId AND tenant_id = :tenantId LIMIT 1',
    { leaseId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Bail introuvable');
  if (rows[0].status !== 'active') throw new ApiError(400, 'Ce bail est terminé : impossible d\'y rattacher une facture');
  return rows[0];
}

/** Charge une facture de l'entreprise courante (non supprimée), ou lève 404. */
async function loadCharge(conn, tenantId, id) {
  const [rows] = await conn.query(
    'SELECT * FROM utility_charges WHERE id = :id AND tenant_id = :tenantId AND deleted_at IS NULL LIMIT 1',
    { id, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Facture introuvable');
  return rows[0];
}

// GET /api/charges/meta — catalogues pour construire les formulaires.
router.get('/meta', (_req, res) => {
  res.json({ utilityTypes: UTILITY_TYPES, statuses: CHARGE_STATUSES });
});

// GET /api/charges?status=&utilityType=&leaseId=&q= — registre des charges SONEB/SBEE.
router.get('/', async (req, res, next) => {
  try {
    const params = { tenantId: req.user.tenantId };
    let where = 'uc.tenant_id = :tenantId AND uc.deleted_at IS NULL';

    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && CHARGE_STATUSES.includes(status)) {
      where += ' AND uc.status = :status';
      params.status = status;
    }

    const utilityType = typeof req.query.utilityType === 'string' ? req.query.utilityType : '';
    if (utilityType === 'soneb' || utilityType === 'sbee') {
      where += ' AND uc.utility_type = :utilityType';
      params.utilityType = utilityType;
    }

    const leaseId = Number(req.query.leaseId);
    if (Number.isInteger(leaseId) && leaseId > 0) {
      where += ' AND uc.lease_id = :leaseId';
      params.leaseId = leaseId;
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where += ' AND (r.first_name LIKE :q OR r.last_name LIKE :q OR u.code LIKE :q)';
      params.q = `%${q}%`;
    }

    const [rows] = await pool.query(
      `SELECT ${CHARGE_SELECT} ${CHARGE_JOINS} WHERE ${where} ORDER BY uc.billed_at DESC, uc.id DESC`,
      params,
    );

    res.json({ charges: rows.map(toPublicCharge) });
  } catch (err) {
    next(err);
  }
});

// POST /api/charges — enregistrer une facture SONEB/SBEE sur un bail actif.
router.post('/', async (req, res, next) => {
  const parsed = createChargeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    await loadActiveLease(pool, req.user.tenantId, data.leaseId);
    await assertPeriodOpen(req.user.tenantId, data.billedAt);

    // Le montant n'est jamais saisi : toujours consommation (index fin -
    // index début) × prix unitaire, arrondi au franc le plus proche.
    const consumption = data.readingEnd - data.readingStart;
    const amount = Math.round(consumption * data.unitPrice);

    const [result] = await pool.query(
      `INSERT INTO utility_charges
         (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end,
          unit_price, amount, billed_at, notes, recorded_by)
       VALUES (:tenantId, :leaseId, :utilityType, :periodStart, :periodEnd, :readingStart, :readingEnd,
               :unitPrice, :amount, :billedAt, :notes, :recordedBy)`,
      {
        tenantId: req.user.tenantId,
        leaseId: data.leaseId,
        utilityType: data.utilityType,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        readingStart: data.readingStart,
        readingEnd: data.readingEnd,
        unitPrice: data.unitPrice,
        amount,
        billedAt: data.billedAt,
        notes: data.notes,
        recordedBy: req.user.id,
      },
    );

    logger.info('Charge SONEB/SBEE enregistrée', {
      tenantId: req.user.tenantId,
      chargeId: result.insertId,
      leaseId: data.leaseId,
      utilityType: data.utilityType,
      consumption,
      amount,
      by: req.user.id,
    });
    res.status(201).json({ chargeId: result.insertId, consumption, amount });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/charges/:id — corriger une facture avant règlement.
router.patch('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateChargeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const existing = await loadCharge(pool, req.user.tenantId, id);
    await assertPeriodOpen(req.user.tenantId, existing.billed_at);
    if (data.billedAt !== undefined) {
      await assertPeriodOpen(req.user.tenantId, data.billedAt);
    }

    const fields = [];
    const params = { id };
    if (data.utilityType !== undefined) { fields.push('utility_type = :utilityType'); params.utilityType = data.utilityType; }
    if (data.periodStart !== undefined) { fields.push('period_start = :periodStart'); params.periodStart = data.periodStart; }
    if (data.periodEnd !== undefined) { fields.push('period_end = :periodEnd'); params.periodEnd = data.periodEnd; }
    if (data.readingStart !== undefined) { fields.push('reading_start = :readingStart'); params.readingStart = data.readingStart; }
    if (data.readingEnd !== undefined) { fields.push('reading_end = :readingEnd'); params.readingEnd = data.readingEnd; }
    if (data.unitPrice !== undefined) { fields.push('unit_price = :unitPrice'); params.unitPrice = data.unitPrice; }
    if (data.billedAt !== undefined) { fields.push('billed_at = :billedAt'); params.billedAt = data.billedAt; }
    if (data.notes !== undefined) { fields.push('notes = :notes'); params.notes = data.notes; }

    // Le montant recalcule dès que l'un des trois facteurs change, en
    // combinant les nouvelles valeurs avec celles déjà en base.
    if (data.readingStart !== undefined || data.readingEnd !== undefined || data.unitPrice !== undefined) {
      const readingStart = data.readingStart ?? existing.reading_start;
      const readingEnd = data.readingEnd ?? existing.reading_end;
      const unitPrice = data.unitPrice ?? Number(existing.unit_price);
      if (readingEnd < readingStart) {
        throw new ApiError(400, "L'index de fin doit être supérieur ou égal à l'index de début", {
          readingEnd: ["L'index de fin doit être supérieur ou égal à l'index de début"],
        });
      }
      fields.push('amount = :amount');
      params.amount = Math.round((readingEnd - readingStart) * unitPrice);
    }

    if (fields.length > 0) {
      await pool.query(`UPDATE utility_charges SET ${fields.join(', ')} WHERE id = :id`, params);
    }

    const [rows] = await pool.query(`SELECT ${CHARGE_SELECT} ${CHARGE_JOINS} WHERE uc.id = :id`, { id });
    res.json({ charge: toPublicCharge(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/charges/:id/pay — marquer la facture comme réglée par le locataire.
router.patch('/:id/pay', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = payChargeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const charge = await loadCharge(pool, req.user.tenantId, id);
    if (charge.status === 'payee') throw new ApiError(400, 'Cette facture est déjà marquée payée.');
    await assertPeriodOpen(req.user.tenantId, charge.billed_at);

    await pool.query(
      `UPDATE utility_charges
       SET status = 'payee', paid_at = :paidAt, payment_method = :paymentMethod, paid_recorded_by = :by
       WHERE id = :id`,
      { paidAt: data.paidAt, paymentMethod: data.paymentMethod, by: req.user.id, id },
    );

    logger.info('Charge SONEB/SBEE réglée', { tenantId: req.user.tenantId, chargeId: id, by: req.user.id });

    const [rows] = await pool.query(`SELECT ${CHARGE_SELECT} ${CHARGE_JOINS} WHERE uc.id = :id`, { id });
    res.json({ charge: toPublicCharge(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/charges/:id — suppression logique d'une facture mal saisie : la
// trace reste en base (visible du DG via /api/accounting/deleted-entries)
// avec une justification obligatoire, mais le montant sort des totaux.
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = deleteReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  }
  const { reason } = parsed.data;

  try {
    const existing = await loadCharge(pool, req.user.tenantId, id);
    await assertPeriodOpen(req.user.tenantId, existing.billed_at);
    await pool.query(
      'UPDATE utility_charges SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason WHERE id = :id',
      { by: req.user.id, reason, id },
    );
    logger.info('Charge SONEB/SBEE supprimée (suppression logique)', {
      tenantId: req.user.tenantId,
      chargeId: id,
      by: req.user.id,
      reason,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
