'use strict';

/**
 * Fiches de paie (demande utilisateur, 2026-10-18) : paiement du salaire d'un employé (comptable,
 * agent ou DG lui-même — décision explicite de l'utilisateur). RÉSERVÉ AU DG (comme la gestion des
 * employés, `routes/employees.js`) : jamais délégable via une permission, la rémunération du
 * personnel reste une donnée sensible. Chaque fiche crée une dépense classique
 * (`expenses.category = 'salaires'`) pour le NET réellement versé — c'est elle qui réduit la recette
 * de l'entreprise et déclenche l'écriture comptable `salaire_paye` si la comptabilité avancée est
 * active (règle déjà existante, voir `db/seedGeneralLedger.js`).
 */

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createPayslipSchema, updateBaseSalarySchema, deletePayslipSchema } = require('../validators/payslips');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('../services/accountingPeriods');
const { claimIdempotencyKey } = require('../services/paymentGuards');
const { genererEcriture, isModuleActive } = require('../services/gl/glPostingService');
const { extourneEcriture } = require('../services/gl/glReversalService');
const { resolveRoleLabels } = require('../constants/roles');
const { toActor } = require('../utils/actor');
const { streamPayslipPdf } = require('../services/pdf');
const logger = require('../utils/logger');

const router = Router();
router.use(requireAuth, requireRole('dg'));

async function loadTenant(tenantId) {
  const [rows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });
  return rows[0];
}

function toPublicStaff(row, roleLabels) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    roleLabel: roleLabels[row.role] ?? row.role,
    baseSalary: row.base_salary != null ? Number(row.base_salary) : null,
    lastPayslip:
      row.last_period != null
        ? { period: row.last_period, netAmount: Number(row.last_net_amount), paidAt: row.last_paid_at }
        : null,
  };
}

function toPublicPayslip(row, roleLabels) {
  return {
    id: row.id,
    employee: {
      id: row.user_id,
      name: `${row.first_name} ${row.last_name}`,
      role: row.role,
      roleLabel: roleLabels[row.role] ?? row.role,
    },
    period: row.period,
    baseAmount: Number(row.base_amount),
    bonusAmount: Number(row.bonus_amount),
    bonusLabel: row.bonus_label,
    deductionAmount: Number(row.deduction_amount),
    deductionLabel: row.deduction_label,
    grossAmount: Number(row.gross_amount),
    netAmount: Number(row.net_amount),
    paymentMethod: row.payment_method,
    paidAt: row.paid_at,
    createdBy: toActor(row.creator_first_name, row.creator_last_name, row.creator_role, roleLabels),
    createdAt: row.created_at,
  };
}

const PAYSLIP_SELECT = `
  p.*, u.first_name, u.last_name, u.role,
  cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role
`;
const PAYSLIP_JOINS = `
  JOIN users u ON u.id = p.user_id
  JOIN users cu ON cu.id = p.created_by
`;

async function loadPayslip(executor, tenantId, id) {
  const [rows] = await executor.query(
    `SELECT ${PAYSLIP_SELECT} FROM payslips p ${PAYSLIP_JOINS} WHERE p.id = :id AND p.tenant_id = :tenantId AND p.deleted_at IS NULL LIMIT 1`,
    { id, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Fiche de paie introuvable');
  return rows[0];
}

// GET /api/payslips/staff — tout le personnel (DG compris, décision explicite de l'utilisateur) avec
// son salaire de base et sa dernière fiche de paie.
router.get('/staff', async (req, res, next) => {
  try {
    const tenant = await loadTenant(req.user.tenantId);
    const roleLabels = resolveRoleLabels(tenant);
    const [rows] = await pool.query(
      `SELECT u.*, lp.period AS last_period, lp.net_amount AS last_net_amount, lp.paid_at AS last_paid_at
       FROM users u
       LEFT JOIN (
         SELECT p1.user_id, p1.period, p1.net_amount, p1.paid_at
         FROM payslips p1
         WHERE p1.tenant_id = :tenantId AND p1.deleted_at IS NULL
           AND p1.id = (
             SELECT p2.id FROM payslips p2
             WHERE p2.user_id = p1.user_id AND p2.tenant_id = p1.tenant_id AND p2.deleted_at IS NULL
             ORDER BY p2.paid_at DESC, p2.id DESC LIMIT 1
           )
       ) lp ON lp.user_id = u.id
       WHERE u.tenant_id = :tenantId AND u.status = 'active'
       ORDER BY (u.role = 'dg') DESC, u.first_name ASC`,
      { tenantId: req.user.tenantId },
    );
    res.json({ staff: rows.map((r) => toPublicStaff(r, roleLabels)) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/payslips/staff/:userId/base-salary — fixe/efface le salaire de base mémorisé.
router.patch('/staff/:userId/base-salary', async (req, res, next) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateBaseSalarySchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
      id: userId,
      tenantId: req.user.tenantId,
    });
    if (!rows[0]) throw new ApiError(404, 'Employé introuvable');

    await pool.query('UPDATE users SET base_salary = :baseSalary WHERE id = :id', {
      baseSalary: parsed.data.baseSalary,
      id: userId,
    });
    logger.info('Salaire de base mis à jour', { tenantId: req.user.tenantId, userId, baseSalary: parsed.data.baseSalary, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/payslips?userId=&period= — historique, plus récent d'abord.
router.get('/', async (req, res, next) => {
  try {
    const tenant = await loadTenant(req.user.tenantId);
    const roleLabels = resolveRoleLabels(tenant);
    const params = { tenantId: req.user.tenantId };
    let where = 'p.tenant_id = :tenantId AND p.deleted_at IS NULL';
    const userId = Number(req.query.userId);
    if (Number.isInteger(userId)) {
      where += ' AND p.user_id = :userId';
      params.userId = userId;
    }
    const period = typeof req.query.period === 'string' ? req.query.period : '';
    if (/^\d{4}-\d{2}$/.test(period)) {
      where += ' AND p.period = :period';
      params.period = period;
    }
    const [rows] = await pool.query(
      `SELECT ${PAYSLIP_SELECT} FROM payslips p ${PAYSLIP_JOINS} WHERE ${where} ORDER BY p.paid_at DESC, p.id DESC`,
      params,
    );
    res.json({ payslips: rows.map((r) => toPublicPayslip(r, roleLabels)) });
  } catch (err) {
    next(err);
  }
});

/**
 * Enregistre un paiement de salaire DANS la transaction fournie : dépense « salaires » (NET versé), fiche de paie
 * et écriture comptable. Extrait de `POST /` pour être aussi appelé quand un paiement FedaPay est confirmé
 * (`services/payments/effects.js`). `data` = champs du schéma `createPayslipSchema`.
 */
async function recordPayslip(conn, { tenantId, employee, data, createdBy, grossAmount, netAmount, skipIdempotency = false }) {
  // Bug évité (même classe que partout ailleurs dans ce projet) : re-vérifie SOUS VERROU, dans la
  // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
  await assertPeriodOpenLocked(conn, tenantId, data.paidAt);

  if (data.idempotencyKey && !skipIdempotency) {
    await claimIdempotencyKey(conn, tenantId, 'payslip', data.idempotencyKey);
  }

  const employeeName = `${employee.first_name} ${employee.last_name}`;
  const [expenseResult] = await conn.query(
    `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, payment_method, payment_status, paid_at, recorded_by)
     VALUES (:tenantId, 'salaires', :label, :amount, :date, :paymentMethod, 'paid', :date, :recordedBy)`,
    {
      tenantId: tenantId,
      label: `Salaire ${data.period} — ${employeeName}`,
      amount: netAmount,
      date: data.paidAt,
      paymentMethod: data.paymentMethod,
      recordedBy: createdBy,
    },
  );
  const expenseId = expenseResult.insertId;

  const [payslipResult] = await conn.query(
    `INSERT INTO payslips
       (tenant_id, user_id, period, base_amount, bonus_amount, bonus_label, deduction_amount, deduction_label,
        gross_amount, net_amount, payment_method, paid_at, expense_id, created_by)
     VALUES
       (:tenantId, :userId, :period, :baseAmount, :bonusAmount, :bonusLabel, :deductionAmount, :deductionLabel,
        :grossAmount, :netAmount, :paymentMethod, :paidAt, :expenseId, :createdBy)`,
    {
      tenantId: tenantId,
      userId: data.userId,
      period: data.period,
      baseAmount: data.baseAmount,
      bonusAmount: data.bonusAmount,
      bonusLabel: data.bonusLabel,
      deductionAmount: data.deductionAmount,
      deductionLabel: data.deductionLabel,
      grossAmount,
      netAmount,
      paymentMethod: data.paymentMethod,
      paidAt: data.paidAt,
      expenseId,
      createdBy: createdBy,
    },
  );
  const payslipId = payslipResult.insertId;

  if (await isModuleActive(conn, tenantId)) {
    await genererEcriture(conn, {
      tenantId: tenantId,
      operationType: 'salaire_paye',
      entryDate: data.paidAt,
      amount: netAmount,
      paymentMethod: data.paymentMethod,
      narrationVars: { mois: data.period, employe: employeeName },
      sourceTable: 'expenses',
      sourceId: expenseId,
      createdBy: createdBy,
      context: {},
    });
  }

  return { payslipId, expenseId, netAmount };
}

// POST /api/payslips — paie un salaire : crée la fiche ET la dépense correspondante (NET versé),
// avec l'écriture comptable `salaire_paye` si la comptabilité avancée est active.
router.post('/', async (req, res, next) => {
  const parsed = createPayslipSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const [userRows] = await pool.query('SELECT * FROM users WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
      id: data.userId,
      tenantId: req.user.tenantId,
    });
    if (!userRows[0]) throw new ApiError(404, 'Employé introuvable');
    const employee = userRows[0];

    const [existingRows] = await pool.query(
      'SELECT id FROM payslips WHERE tenant_id = :tenantId AND user_id = :userId AND period = :period AND deleted_at IS NULL LIMIT 1',
      { tenantId: req.user.tenantId, userId: data.userId, period: data.period },
    );
    if (existingRows[0]) {
      throw new ApiError(409, `Le salaire de ${employee.first_name} ${employee.last_name} pour ${data.period} a déjà été payé.`);
    }

    await assertPeriodOpen(req.user.tenantId, data.paidAt);

    const grossAmount = data.baseAmount + data.bonusAmount;
    const netAmount = grossAmount - data.deductionAmount;

    await conn.beginTransaction();
    const { payslipId, netAmount: paidNet } = await recordPayslip(conn, {
      tenantId: req.user.tenantId, employee, data, createdBy: req.user.id, grossAmount, netAmount,
    });
    await conn.commit();
    logger.info('Salaire payé', {
      tenantId: req.user.tenantId,
      payslipId,
      userId: data.userId,
      period: data.period,
      netAmount: paidNet,
      by: req.user.id,
    });

    const tenant = await loadTenant(req.user.tenantId);
    const row = await loadPayslip(pool, req.user.tenantId, payslipId);
    res.status(201).json({ payslip: toPublicPayslip(row, resolveRoleLabels(tenant)) });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/payslips/:id/pdf — la fiche de paie, document interne (jamais remis à un tiers), signée
// par le DG qui a enregistré le paiement.
router.get('/:id/pdf', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const row = await loadPayslip(pool, req.user.tenantId, id);
    const tenant = await loadTenant(req.user.tenantId);
    const [employeeRows] = await pool.query('SELECT * FROM users WHERE id = :id LIMIT 1', { id: row.user_id });
    const [issuerRows] = await pool.query('SELECT * FROM users WHERE id = :id LIMIT 1', { id: row.created_by });

    streamPayslipPdf(res, {
      tenant,
      employee: employeeRows[0],
      payslip: row,
      issuer: issuerRows[0] || null,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/payslips/:id { reason } — annule la fiche ET sa dépense (extourne l'écriture GL si
// elle existe), même principe que l'annulation d'une dépense classique (routes/accounting.js).
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = deletePayslipSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  }
  const { reason } = parsed.data;

  const conn = await pool.getConnection();
  try {
    const existing = await loadPayslip(pool, req.user.tenantId, id);
    await assertPeriodOpen(req.user.tenantId, existing.paid_at);

    const todayIso = new Date().toISOString().slice(0, 10);
    const [existingGlEntries] = await pool.query(
      `SELECT id, status FROM gl_entries WHERE tenant_id = :tenantId AND source_table = 'expenses' AND source_id = :expenseId`,
      { tenantId: req.user.tenantId, expenseId: existing.expense_id },
    );
    const validatedGlEntries = existingGlEntries.filter((e) => e.status === 'validee');
    if (validatedGlEntries.length > 0) await assertPeriodOpen(req.user.tenantId, todayIso);

    await conn.beginTransaction();
    // Bug évité (même classe que partout ailleurs) : re-vérifie SOUS VERROU, dans la transaction.
    await assertPeriodOpenLocked(conn, req.user.tenantId, existing.paid_at);
    if (validatedGlEntries.length > 0) await assertPeriodOpenLocked(conn, req.user.tenantId, todayIso);

    await conn.query('UPDATE payslips SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason WHERE id = :id', {
      by: req.user.id,
      reason,
      id,
    });
    if (existing.expense_id) {
      await conn.query(
        'UPDATE expenses SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason WHERE id = :id',
        { by: req.user.id, reason: `Fiche de paie annulée — ${reason}`, id: existing.expense_id },
      );
    }
    for (const entry of validatedGlEntries) {
      await extourneEcriture(conn, {
        tenantId: req.user.tenantId,
        entryId: entry.id,
        entryDate: todayIso,
        userId: req.user.id,
        reason: `Fiche de paie annulée — ${reason}`,
      });
    }

    await conn.commit();
    logger.info('Fiche de paie annulée', { tenantId: req.user.tenantId, payslipId: id, by: req.user.id, reason });
    res.status(204).send();
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
module.exports.recordPayslip = recordPayslip;
