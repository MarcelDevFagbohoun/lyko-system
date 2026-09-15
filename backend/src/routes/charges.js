'use strict';

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');
const { createChargeSchema, updateChargeSchema, createUtilityPaymentSchema, deleteReasonSchema } = require('../validators/charges');
const { UTILITY_TYPES, UTILITY_TYPE_KEYS, CHARGE_STATUSES } = require('../constants/charges');
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
  const amount = Number(row.amount);
  const lossShareAmount = Number(row.loss_share_amount ?? 0);
  const paidAmount = Number(row.paid_total ?? 0);
  return {
    id: row.id,
    utilityType: row.utility_type,
    periodStart: isoDate(row.period_start),
    periodEnd: isoDate(row.period_end),
    readingStart: row.reading_start,
    readingEnd: row.reading_end,
    consumption: row.reading_end - row.reading_start,
    unitPrice: Number(row.unit_price),
    amount,
    // Part de l'écart compteur/décompteur imputée à cette facture (étape 23,
    // 0 sauf répartition « prorata » activée sur ce Bien) — distincte de la
    // consommation mesurée pour un affichage séparé.
    lossShareAmount,
    consumptionAmount: amount - lossShareAmount,
    billedAt: isoDate(row.billed_at),
    status: row.status,
    paidAmount,
    remainingAmount: Math.max(0, amount - paidAmount),
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
  COALESCE(pt.paid_total, 0) AS paid_total,
  l.status AS lease_status,
  r.id AS renter_id, r.first_name AS renter_first_name, r.last_name AS renter_last_name,
  u.id AS unit_id, u.code AS unit_code,
  p.id AS property_id, p.code AS property_code,
  ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name, ru.role AS recorder_role,
  pu.first_name AS payer_first_name, pu.last_name AS payer_last_name, pu.role AS payer_role
`;
const CHARGE_JOINS = `
  FROM utility_charges uc
  LEFT JOIN (SELECT charge_id, SUM(amount) AS paid_total FROM utility_payments GROUP BY charge_id) pt ON pt.charge_id = uc.id
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

// GET /api/charges/previous-reading?leaseId=&utilityType= — index de fin de
// la dernière facture de ce bail pour ce fluide, pour préremplir l'index de
// début d'une nouvelle facture (jamais besoin de le ressaisir) — même
// principe que le relevé par immeuble (utilityReadings.js).
router.get('/previous-reading', async (req, res, next) => {
  const leaseId = Number(req.query.leaseId);
  const utilityType = typeof req.query.utilityType === 'string' ? req.query.utilityType : '';
  if (!Number.isInteger(leaseId) || leaseId <= 0) return next(new ApiError(400, 'Bail invalide'));
  if (!UTILITY_TYPE_KEYS.includes(utilityType)) return next(new ApiError(400, 'Fluide invalide'));

  try {
    const [[row]] = await pool.query(
      `SELECT reading_end FROM utility_charges
       WHERE tenant_id = :tenantId AND lease_id = :leaseId AND utility_type = :utilityType AND deleted_at IS NULL
       ORDER BY billed_at DESC, id DESC LIMIT 1`,
      { tenantId: req.user.tenantId, leaseId, utilityType },
    );
    res.json({ readingEnd: row ? row.reading_end : null });
  } catch (err) {
    next(err);
  }
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

    // Un paiement (même partiel) déjà enregistré fige le montant : le
    // modifier désynchroniserait la facture de ce qui a déjà été réglé.
    if (data.readingStart !== undefined || data.readingEnd !== undefined || data.unitPrice !== undefined) {
      const [[{ paidTotal }]] = await pool.query(
        'SELECT COALESCE(SUM(amount), 0) AS paidTotal FROM utility_payments WHERE charge_id = :id',
        { id },
      );
      if (Number(paidTotal) > 0) {
        throw new ApiError(409, 'Un paiement a déjà été enregistré sur cette facture — impossible de modifier le montant.');
      }
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

// GET /api/charges/:id/payments — historique des règlements de cette facture.
router.get('/:id/payments', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    await loadCharge(pool, req.user.tenantId, id);
    const [rows] = await pool.query(
      `SELECT up.id, up.amount, up.payment_method, up.paid_at, up.notes, up.created_at,
              pu.first_name AS recorder_first_name, pu.last_name AS recorder_last_name, pu.role AS recorder_role
       FROM utility_payments up
       LEFT JOIN users pu ON pu.id = up.recorded_by
       WHERE up.charge_id = :id ORDER BY up.paid_at DESC, up.id DESC`,
      { id },
    );
    res.json({
      payments: rows.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paymentMethod: p.payment_method,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
        paidAt: isoDate(p.paid_at),
        notes: p.notes,
        recordedBy: toActor(p.recorder_first_name, p.recorder_last_name, p.recorder_role),
        createdAt: p.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/charges/:id/payments — enregistrer un règlement (total ou partiel).
router.post('/:id/payments', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createUtilityPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const charge = await loadCharge(conn, req.user.tenantId, id);
    if (charge.status === 'payee') throw new ApiError(400, 'Cette facture est déjà entièrement réglée.');
    await assertPeriodOpen(req.user.tenantId, charge.billed_at);

    await conn.beginTransaction();
    // Sérialise les enregistrements concurrents sur cette facture — même
    // principe que les paiements de loyer (routes/leases.js).
    await conn.query('SELECT id FROM utility_charges WHERE id = :id FOR UPDATE', { id });

    const [[{ paidTotal }]] = await conn.query(
      'SELECT COALESCE(SUM(amount), 0) AS paidTotal FROM utility_payments WHERE charge_id = :id',
      { id },
    );
    const remaining = Number(charge.amount) - Number(paidTotal);
    if (data.amount > remaining) {
      throw new ApiError(400, `Le montant dépasse le solde restant (${remaining} FCFA).`);
    }

    // Garde anti-doublon : un règlement identique tout juste enregistré
    // (< 2 min, même date/mode/montant) est très probablement un double-clic.
    const [recent] = await conn.query(
      `SELECT COUNT(*) AS n FROM utility_payments
       WHERE charge_id = :id AND paid_at = :paidAt AND payment_method = :method AND amount = :amount
         AND created_at > (NOW() - INTERVAL 2 MINUTE)`,
      { id, paidAt: data.paidAt, method: data.paymentMethod, amount: data.amount },
    );
    if (Number(recent[0].n) > 0) {
      throw new ApiError(409, 'Un règlement identique vient d\'être enregistré. Rechargez la page pour le voir.');
    }

    await conn.query(
      `INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, notes, recorded_by)
       VALUES (:tenantId, :chargeId, :amount, :paymentMethod, :paidAt, :notes, :recordedBy)`,
      {
        tenantId: req.user.tenantId,
        chargeId: id,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        paidAt: data.paidAt,
        notes: data.notes,
        recordedBy: req.user.id,
      },
    );

    const newPaidTotal = Number(paidTotal) + data.amount;
    const newStatus = newPaidTotal >= Number(charge.amount) ? 'payee' : 'partiellement_payee';
    await conn.query(
      `UPDATE utility_charges
       SET status = :status, paid_at = :paidAt, payment_method = :paymentMethod, paid_recorded_by = :by
       WHERE id = :id`,
      { status: newStatus, paidAt: data.paidAt, paymentMethod: data.paymentMethod, by: req.user.id, id },
    );
    await conn.commit();

    logger.info('Règlement facture SONEB/SBEE enregistré', {
      tenantId: req.user.tenantId,
      chargeId: id,
      amount: data.amount,
      newStatus,
      by: req.user.id,
    });

    const [rows] = await pool.query(`SELECT ${CHARGE_SELECT} ${CHARGE_JOINS} WHERE uc.id = :id`, { id });
    res.status(201).json({ charge: toPublicCharge(rows[0]) });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
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
