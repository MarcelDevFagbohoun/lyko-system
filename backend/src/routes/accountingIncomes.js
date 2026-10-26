'use strict';

/**
 * Autres entrées d'argent du cabinet (21/10/2026) : honoraires, intérêts, remboursements, subventions…
 * Monté sous `/api/accounting/incomes`. 100 % produit du cabinet. Même discipline que les dépenses :
 * période ouverte (vérifiée sous verrou), idempotence, écriture GL dans la MÊME transaction, justificatif
 * optionnel nettoyé si la transaction échoue, suppression logique avec justification + extourne GL.
 */
const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { INCOME_CATEGORIES, INCOME_CATEGORY_KEYS } = require('../constants/incomes');
const { INCOME_CATEGORY_TO_OPERATION_TYPE } = require('../constants/glOperationTypes');
const { createIncomeSchema } = require('../validators/incomes');
const { deleteReasonSchema } = require('../validators/expenses');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('../services/accountingPeriods');
const { genererEcriture, isModuleActive } = require('../services/gl/glPostingService');
const { extourneEcriture } = require('../services/gl/glReversalService');
const { claimIdempotencyKey } = require('../services/paymentGuards');
const { assertUploadType, randomFileName, toProtectedFileUrl } = require('../utils/uploads');
const { toActor } = require('../utils/actor');
const logger = require('../utils/logger');
const { isoDate } = require('../utils/dates');

const router = Router();
router.use(requireAuth);
const canAccounting = requirePermission('comptabilite');
const canRecordIncome = requirePermission('depenses_enregistrer');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) return cb(new ApiError(400, 'Justificatif : formats acceptés PNG, JPEG, WEBP, PDF (5 Mo max)'));
    cb(null, true);
  },
});

const PAYMENT_METHOD_LABELS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement bancaire', cheque: 'Chèque' };

function toPublicIncome(row) {
  return {
    id: row.id,
    category: row.category,
    categoryLabel: INCOME_CATEGORIES.find((c) => c.key === row.category)?.label ?? row.category,
    label: row.label,
    amount: Number(row.amount),
    incomeDate: isoDate(row.income_date),
    paymentMethod: row.payment_method,
    paymentMethodLabel: PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method,
    payerName: row.payer_name,
    reference: row.reference,
    notes: row.notes,
    receiptUrl: row.receipt_path ? toProtectedFileUrl(row.receipt_path) : null,
    recordedBy: toActor(row.recorded_by_first_name, row.recorded_by_last_name, row.recorded_by_role),
    createdAt: row.created_at,
  };
}

router.get('/meta', canAccounting, (_req, res) => {
  res.json({
    categories: INCOME_CATEGORIES,
    paymentMethods: Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => ({ key, label })),
  });
});

// GET /api/accounting/incomes?from=&to=&category=&q=
router.get('/', canAccounting, async (req, res, next) => {
  try {
    const params = { tenantId: req.user.tenantId };
    let where = 'i.tenant_id = :tenantId AND i.deleted_at IS NULL';
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where += ' AND i.income_date >= :from'; params.from = from; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where += ' AND i.income_date <= :to'; params.to = to; }
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    if (INCOME_CATEGORY_KEYS.includes(category)) { where += ' AND i.category = :category'; params.category = category; }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) { where += ' AND (i.label LIKE :q OR i.payer_name LIKE :q)'; params.q = `%${q}%`; }

    const [rows] = await pool.query(
      `SELECT i.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name, u.role AS recorded_by_role
       FROM other_incomes i JOIN users u ON u.id = i.recorded_by
       WHERE ${where} ORDER BY i.created_at DESC, i.id DESC LIMIT 500`,
      params,
    );
    const incomes = rows.map(toPublicIncome);
    res.json({ incomes, total: incomes.reduce((s, i) => s + i.amount, 0) });
  } catch (err) {
    next(err);
  }
});

// POST /api/accounting/incomes — enregistrer une entrée (+ justificatif optionnel).
router.post('/', canAccounting, canRecordIncome, upload.single('receipt'), async (req, res, next) => {
  const parsed = createIncomeSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const data = parsed.data;

  const conn = await pool.getConnection();
  let writtenReceiptPath = null;
  try {
    await assertPeriodOpen(req.user.tenantId, data.incomeDate);
    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, req.user.tenantId, data.incomeDate);
    if (data.idempotencyKey) await claimIdempotencyKey(conn, req.user.tenantId, 'other_income', data.idempotencyKey);

    const [result] = await conn.query(
      `INSERT INTO other_incomes (tenant_id, category, label, amount, income_date, payment_method, payer_name, reference, notes, recorded_by)
       VALUES (:tenantId, :category, :label, :amount, :incomeDate, :paymentMethod, :payerName, :reference, :notes, :by)`,
      {
        tenantId: req.user.tenantId,
        category: data.category,
        label: data.label,
        amount: data.amount,
        incomeDate: data.incomeDate,
        paymentMethod: data.paymentMethod,
        payerName: data.payerName,
        reference: data.reference,
        notes: data.notes,
        by: req.user.id,
      },
    );
    const incomeId = result.insertId;

    if (req.file) {
      const ext = assertUploadType(req.file, { pdf: true, label: 'Justificatif' });
      const dir = path.join(UPLOADS_ROOT, `tenants/${req.user.tenantId}/incomes`);
      await fs.mkdir(dir, { recursive: true });
      const rel = `tenants/${req.user.tenantId}/incomes/${randomFileName(String(incomeId), ext)}`;
      await fs.writeFile(path.join(UPLOADS_ROOT, rel), req.file.buffer);
      writtenReceiptPath = rel;
      await conn.query('UPDATE other_incomes SET receipt_path = :path WHERE id = :id', { path: rel, id: incomeId });
    }

    if (await isModuleActive(conn, req.user.tenantId)) {
      const operationType = INCOME_CATEGORY_TO_OPERATION_TYPE[data.category];
      if (!operationType) throw new Error(`Catégorie d'entrée sans correspondance comptable : ${data.category}`);
      await genererEcriture(conn, {
        tenantId: req.user.tenantId,
        operationType,
        entryDate: data.incomeDate,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        narrationVars: { libelle: data.label, mois: data.incomeDate.slice(0, 7) },
        sourceTable: 'other_incomes',
        sourceId: incomeId,
        createdBy: req.user.id,
        context: {},
      });
    }

    await conn.commit();
    logger.info('Autre entrée enregistrée', { tenantId: req.user.tenantId, incomeId, amount: data.amount, by: req.user.id });
    res.status(201).json({ incomeId });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (writtenReceiptPath) await fs.unlink(path.join(UPLOADS_ROOT, writtenReceiptPath)).catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// DELETE /api/accounting/incomes/:id — suppression logique (justification obligatoire) + extourne GL.
router.delete('/:id', canAccounting, canRecordIncome, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = deleteReasonSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  const { reason } = parsed.data;

  const conn = await pool.getConnection();
  try {
    const [rows] = await pool.query(
      'SELECT * FROM other_incomes WHERE id = :id AND tenant_id = :tenantId AND deleted_at IS NULL LIMIT 1',
      { id, tenantId: req.user.tenantId },
    );
    const existing = rows[0];
    if (!existing) throw new ApiError(404, 'Entrée introuvable');
    await assertPeriodOpen(req.user.tenantId, isoDate(existing.income_date));

    const todayIso = new Date().toISOString().slice(0, 10);
    const [glRows] = await pool.query(
      `SELECT id FROM gl_entries WHERE tenant_id = :tenantId AND source_table = 'other_incomes' AND source_id = :id AND status = 'validee'`,
      { tenantId: req.user.tenantId, id },
    );
    if (glRows.length > 0) await assertPeriodOpen(req.user.tenantId, todayIso);

    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, req.user.tenantId, isoDate(existing.income_date));
    if (glRows.length > 0) await assertPeriodOpenLocked(conn, req.user.tenantId, todayIso);
    const [upd] = await conn.query(
      'UPDATE other_incomes SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason WHERE id = :id AND deleted_at IS NULL',
      { by: req.user.id, reason, id },
    );
    if (upd.affectedRows !== 1) throw new ApiError(409, 'Entrée déjà supprimée');
    for (const e of glRows) {
      await extourneEcriture(conn, {
        tenantId: req.user.tenantId,
        entryId: e.id,
        entryDate: todayIso,
        userId: req.user.id,
        reason: `Entrée supprimée — ${reason}`,
      });
    }
    await conn.commit();
    logger.info('Autre entrée supprimée', { tenantId: req.user.tenantId, incomeId: id, by: req.user.id, reason });
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
