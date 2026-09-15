'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission, requireAnyPermission, requireRole } = require('../middleware/auth');
const {
  createExpenseSchema,
  updateExpenseSchema,
  dashboardQuerySchema,
  closePeriodSchema,
  deleteReasonSchema,
  startDateSchema,
} = require('../validators/expenses');
const { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, EXPENSE_PAYMENT_METHODS } = require('../constants/expenses');
const { toActor } = require('../utils/actor');
const { assertUploadType, randomFileName } = require('../utils/uploads');
const { assertPeriodOpen, isPeriodClosed, getPeriodClosability } = require('../services/accountingPeriods');
const { listPortfolioArrears, listPredictiveLateAlerts } = require('../services/rentTracking');
const { listDeletedEntries } = require('../services/activity');
const { resolvePropertyScope } = require('../services/scope');
const { streamAccountingReportPdf } = require('../services/pdf');
const logger = require('../utils/logger');

const router = Router();
router.use(requireAuth);
// Module strictement financier : réservé à la comptabilité (le DG passe
// toujours via le rôle) — pas d'élargissement à locataires/proprietaires,
// cohérent avec le catalogue de permissions existant depuis l'étape 3.
// Appliqué explicitement à chaque route (pas en tête de router) car
// GET /periods doit aussi rester lisible par la permission `charges` — la
// clôture d'un mois bloque aussi les charges SONEB/SBEE, qui doivent
// pouvoir en connaître le statut.
const canAccounting = requirePermission('comptabilite');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
// Un justificatif de dépense est souvent une facture PDF, contrairement aux
// photos (Bien/plaintes) qui n'acceptent que des images.
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new ApiError(400, 'Justificatif : formats acceptés PNG, JPEG, WEBP, PDF (5 Mo max)'));
    }
    cb(null, true);
  },
});

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

function toPublicExpense(row) {
  return {
    id: row.id,
    category: row.category,
    label: row.label,
    amount: Number(row.amount),
    expenseDate: isoDate(row.expense_date),
    paymentMethod: row.payment_method,
    paymentMethodLabel: PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method,
    notes: row.notes,
    receiptUrl: row.receipt_path ? `/uploads/${row.receipt_path}` : null,
    // Facultatif : dépense rattachée à un Bien (et une Unité précise en son
    // sein) pour la calculette de recette/commission — null pour une dépense
    // de fonctionnement du cabinet (comportement historique, inchangé).
    propertyId: row.property_id ?? null,
    unitId: row.unit_id ?? null,
    // Présent seulement quand la requête l'a joint (journal du cabinet) —
    // `undefined` ailleurs (POST/PATCH), traité comme `null` : sans incidence,
    // ces réponses ne servent qu'à confirmer l'écriture, pas à l'afficher.
    propertyCode: row.property_code ?? null,
    recordedBy: toActor(row.recorded_by_first_name, row.recorded_by_last_name, row.recorded_by_role),
    createdAt: row.created_at,
  };
}

/** Charge une dépense de l'entreprise courante (non supprimée), ou lève 404. */
async function loadExpense(conn, tenantId, id) {
  const [rows] = await conn.query(
    'SELECT * FROM expenses WHERE id = :id AND tenant_id = :tenantId AND deleted_at IS NULL LIMIT 1',
    { id, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Dépense introuvable');
  return rows[0];
}

// GET /api/accounting/meta — catalogues pour construire les formulaires.
router.get('/meta', canAccounting, (_req, res) => {
  res.json({ categories: EXPENSE_CATEGORIES, paymentMethods: EXPENSE_PAYMENT_METHODS });
});

// GET /api/accounting/expenses?from=&to=&category=&q= — journal des dépenses.
router.get('/expenses', canAccounting, async (req, res, next) => {
  try {
    const params = { tenantId: req.user.tenantId };
    let where = 'e.tenant_id = :tenantId AND e.deleted_at IS NULL';

    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    if (from) { where += ' AND e.expense_date >= :from'; params.from = from; }
    if (to) { where += ' AND e.expense_date <= :to'; params.to = to; }

    const category = typeof req.query.category === 'string' ? req.query.category : '';
    if (category && EXPENSE_CATEGORY_KEYS.includes(category)) {
      where += ' AND e.category = :category';
      params.category = category;
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where += ' AND e.label LIKE :q';
      params.q = `%${q}%`;
    }

    const propertyId = Number(req.query.propertyId);
    if (Number.isInteger(propertyId) && propertyId > 0) {
      where += ' AND e.property_id = :propertyId';
      params.propertyId = propertyId;
    }

    // Journal = ordre de SAISIE (la plus récemment enregistrée en tête),
    // pas la date de dépense choisie par l'utilisateur : une dépense
    // ressaisie plus tard avec une date antérieure ne doit pas se retrouver
    // « perdue » en dessous d'anciennes saisies simplement mieux datées.
    // `p.code` : pour distinguer d'un coup d'œil, dans ce journal commun, une
    // dépense de fonctionnement du cabinet d'un travaux facturé à un Bien
    // (donc à son propriétaire — voir `GET /dashboard` ci-dessus).
    const [rows] = await pool.query(
      `SELECT e.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name, u.role AS recorded_by_role,
              p.code AS property_code
       FROM expenses e
       JOIN users u ON u.id = e.recorded_by
       LEFT JOIN properties p ON p.id = e.property_id
       WHERE ${where}
       ORDER BY e.created_at DESC, e.id DESC`,
      params,
    );

    res.json({ expenses: rows.map(toPublicExpense) });
  } catch (err) {
    next(err);
  }
});

// POST /api/accounting/expenses — enregistrer une dépense (+ justificatif optionnel).
router.post('/expenses', canAccounting, upload.single('receipt'), async (req, res, next) => {
  const parsed = createExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    await assertPeriodOpen(req.user.tenantId, data.expenseDate);

    // Un `unitId` exige un `propertyId` (l'unité doit appartenir à ce Bien) ;
    // les deux, si fournis, doivent exister dans l'entreprise courante.
    if (data.propertyId) {
      const [propRows] = await conn.query('SELECT id FROM properties WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
        id: data.propertyId,
        tenantId: req.user.tenantId,
      });
      if (!propRows[0]) throw new ApiError(404, 'Bien introuvable');
    }
    if (data.unitId) {
      if (!data.propertyId) throw new ApiError(400, 'Sélectionnez le Bien avant son Unité');
      const [unitRows] = await conn.query(
        'SELECT id FROM property_units WHERE id = :id AND property_id = :propertyId AND tenant_id = :tenantId LIMIT 1',
        { id: data.unitId, propertyId: data.propertyId, tenantId: req.user.tenantId },
      );
      if (!unitRows[0]) throw new ApiError(404, 'Unité introuvable pour ce Bien');
    }

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, payment_method, notes, property_id, unit_id, recorded_by)
       VALUES (:tenantId, :category, :label, :amount, :expenseDate, :paymentMethod, :notes, :propertyId, :unitId, :by)`,
      {
        tenantId: req.user.tenantId,
        category: data.category,
        label: data.label,
        amount: data.amount,
        expenseDate: data.expenseDate,
        paymentMethod: data.paymentMethod,
        notes: data.notes,
        propertyId: data.propertyId ?? null,
        unitId: data.unitId ?? null,
        by: req.user.id,
      },
    );
    const expenseId = result.insertId;

    if (req.file) {
      const ext = assertUploadType(req.file, { pdf: true, label: 'Justificatif' }); // image OU PDF
      const dir = path.join(UPLOADS_ROOT, `tenants/${req.user.tenantId}/expenses`);
      await fs.mkdir(dir, { recursive: true });
      const rel = `tenants/${req.user.tenantId}/expenses/${randomFileName(String(expenseId), ext)}`;
      await fs.writeFile(path.join(UPLOADS_ROOT, rel), req.file.buffer);
      await conn.query('UPDATE expenses SET receipt_path = :path WHERE id = :id', { path: rel, id: expenseId });
    }

    await conn.commit();
    logger.info('Dépense enregistrée', { tenantId: req.user.tenantId, expenseId, amount: data.amount, by: req.user.id });
    res.status(201).json({ expenseId });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// PATCH /api/accounting/expenses/:id — corriger une dépense.
router.patch('/expenses/:id', canAccounting, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const existing = await loadExpense(pool, req.user.tenantId, id);
    await assertPeriodOpen(req.user.tenantId, existing.expense_date);
    if (data.expenseDate !== undefined) {
      await assertPeriodOpen(req.user.tenantId, data.expenseDate);
    }

    const fields = [];
    const params = { id };
    if (data.category !== undefined) { fields.push('category = :category'); params.category = data.category; }
    if (data.label !== undefined) { fields.push('label = :label'); params.label = data.label; }
    if (data.amount !== undefined) { fields.push('amount = :amount'); params.amount = data.amount; }
    if (data.expenseDate !== undefined) { fields.push('expense_date = :expenseDate'); params.expenseDate = data.expenseDate; }
    if (data.paymentMethod !== undefined) { fields.push('payment_method = :paymentMethod'); params.paymentMethod = data.paymentMethod; }
    if (data.notes !== undefined) { fields.push('notes = :notes'); params.notes = data.notes; }

    if (fields.length > 0) {
      await pool.query(`UPDATE expenses SET ${fields.join(', ')} WHERE id = :id`, params);
    }

    const [rows] = await pool.query(
      `SELECT e.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name, u.role AS recorded_by_role
       FROM expenses e JOIN users u ON u.id = e.recorded_by WHERE e.id = :id`,
      { id },
    );
    res.json({ expense: toPublicExpense(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/accounting/expenses/:id — suppression logique d'une dépense mal
// saisie : la trace reste en base (visible du DG via /deleted-entries) avec
// une justification obligatoire, mais le montant sort des totaux/recettes.
router.delete('/expenses/:id', canAccounting, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = deleteReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  }
  const { reason } = parsed.data;

  try {
    const existing = await loadExpense(pool, req.user.tenantId, id);
    await assertPeriodOpen(req.user.tenantId, existing.expense_date);
    await pool.query(
      'UPDATE expenses SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason WHERE id = :id',
      { by: req.user.id, reason, id },
    );
    logger.info('Dépense supprimée (suppression logique)', {
      tenantId: req.user.tenantId,
      expenseId: id,
      by: req.user.id,
      reason,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/dashboard?from=&to= — tableau de bord consolidé, classé
// par nature : loyers encaissés, versements propriétaires, dépenses, charges
// SONEB/SBEE impayées, et une estimation des impayés locataires (retards en
// cours, pas seulement sur la période — un retard reste un retard tant qu'il
// n'est pas soldé).
/**
 * Calcul du tableau de bord comptable pour une période — extrait en
 * fonction nommée pour être réutilisé tel quel par `GET /dashboard` (JSON,
 * écran) et `GET /dashboard.pdf` (rapport mensuel exportable, étape 18) :
 * un seul calcul, jamais dupliqué entre les deux formats de sortie.
 */
async function computeAccountingDashboard(user, { from, to }) {
    const params = { tenantId: user.tenantId, from, to };

    const [[rentRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
       FROM rent_payments WHERE tenant_id = :tenantId AND paid_at BETWEEN :from AND :to`,
      params,
    );
    const [[payoutRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
       FROM owner_payouts WHERE tenant_id = :tenantId AND paid_at BETWEEN :from AND :to`,
      params,
    );
    // Dépenses du CABINET uniquement (`property_id IS NULL`) : les travaux
    // facturés à un Bien précis ne sont pas un coût de fonctionnement de
    // l'entreprise — ils sont déjà déduits de la recette du PROPRIÉTAIRE
    // concerné (`services/commission.js`, `getRecetteProprietaire`, carte
    // « Recette du mois » sur la fiche du Bien). Les compter aussi ici
    // ferait payer deux fois le même travaux : une fois au propriétaire, une
    // fois (à tort) au solde du cabinet.
    const [[expenseRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
       FROM expenses
       WHERE tenant_id = :tenantId AND deleted_at IS NULL AND property_id IS NULL
         AND expense_date BETWEEN :from AND :to`,
      params,
    );
    const [byCategory] = await pool.query(
      `SELECT category, COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE tenant_id = :tenantId AND deleted_at IS NULL AND property_id IS NULL
         AND expense_date BETWEEN :from AND :to
       GROUP BY category ORDER BY total DESC`,
      params,
    );
    // Informatif seulement : total des travaux facturés aux Biens sur la
    // période, pour ne pas donner l'impression que cet argent a disparu du
    // suivi — il reste visible ici, et déduit là où il doit l'être (fiche du
    // propriétaire concerné), jamais dans les totaux du cabinet ci-dessus.
    const [[propertyExpenseRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
       FROM expenses
       WHERE tenant_id = :tenantId AND deleted_at IS NULL AND property_id IS NOT NULL
         AND expense_date BETWEEN :from AND :to`,
      params,
    );

    // Charges SONEB/SBEE impayées : pas de filtre de période — un impayé
    // reste dû tant qu'il n'est pas réglé, quelle que soit la date de facturation.
    const [[unpaidChargesRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
       FROM utility_charges WHERE tenant_id = :tenantId AND deleted_at IS NULL AND status = 'impayee'`,
      { tenantId: user.tenantId },
    );
    const [unpaidByType] = await pool.query(
      `SELECT utility_type, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
       FROM utility_charges WHERE tenant_id = :tenantId AND deleted_at IS NULL AND status = 'impayee'
       GROUP BY utility_type`,
      { tenantId: user.tenantId },
    );

    // Impayés locataires : estimation par bail actif en retard (jours de
    // retard × loyer déjà connus via computeArrears), pas une écriture
    // enregistrée — « si ça existe, le système fait l'addition ». Calcul
    // partagé avec GET /arrears (centre de relance groupée, étape 10).
    // Portée « Biens gérés » (étape 14) : un agent restreint (rare ici, ce
    // module exige `comptabilite`) ne voit que ses propres impayés.
    const scopeAgentId = await resolvePropertyScope(user);
    const portfolioArrears = await listPortfolioArrears(user.tenantId, scopeAgentId);
    const tenantArrears = portfolioArrears.map((a) => ({
      leaseId: a.leaseId,
      renterName: a.renterName,
      daysLate: a.daysLate,
      unpaidMonths: a.unpaidMonths,
      amountOwed: a.amountOwed,
    }));
    const tenantArrearsTotal = portfolioArrears.reduce((sum, a) => sum + a.amountOwed, 0);

    const rentCollected = Number(rentRow.total);
    const ownerPayouts = Number(payoutRow.total);
    const expensesTotal = Number(expenseRow.total);
    const propertyExpensesTotal = Number(propertyExpenseRow.total);

    const period = from.slice(0, 7);
    const closed = await isPeriodClosed(user.tenantId, from);
    let closedInfo = null;
    let closability = null;
    if (closed) {
      const [[row]] = await pool.query(
        `SELECT ap.closed_at, ap.forced, u.first_name, u.last_name, u.role
         FROM accounting_periods ap JOIN users u ON u.id = ap.closed_by
         WHERE ap.tenant_id = :tenantId AND ap.period = :period LIMIT 1`,
        { tenantId: user.tenantId, period },
      );
      closedInfo = {
        closedAt: row.closed_at,
        closedBy: toActor(row.first_name, row.last_name, row.role),
        forced: !!row.forced,
      };
    } else {
      // Clôturabilité (étape ajustement clôture) : l'échéance de loyer la
      // plus tardive parmi les baux actifs de ce mois précis, propre à
      // chaque locataire (`rent_due_day`), plus une marge de sécurité —
      // jamais une date de clôture choisie à l'aveugle.
      const c = await getPeriodClosability(user.tenantId, period);
      closability = {
        status: c.isClosable ? 'closable' : 'open',
        closableFrom: c.closableFrom,
        maxDueDay: c.maxDueDay,
        pendingLeases: c.pendingLeases,
      };
    }

    return {
      period: { from, to },
      isClosed: closed,
      closedInfo,
      closability,
      totals: {
        rentCollected,
        rentCollectedCount: Number(rentRow.n),
        ownerPayouts,
        ownerPayoutsCount: Number(payoutRow.n),
        expenses: expensesTotal,
        expensesCount: Number(expenseRow.n),
        // Informatif : travaux facturés à un Bien, EXCLUS de `expenses` et
        // de `netCashFlow` ci-dessous — à la charge du propriétaire concerné
        // (déjà déduits de sa recette), jamais du cabinet.
        propertyExpenses: propertyExpensesTotal,
        propertyExpensesCount: Number(propertyExpenseRow.n),
        unpaidCharges: Number(unpaidChargesRow.total),
        unpaidChargesCount: Number(unpaidChargesRow.n),
        tenantArrears: tenantArrearsTotal,
        tenantArrearsCount: tenantArrears.length,
        netCashFlow: rentCollected - ownerPayouts - expensesTotal,
      },
      expensesByCategory: byCategory.map((r) => ({ category: r.category, total: Number(r.total) })),
      unpaidChargesByType: unpaidByType.map((r) => ({
        utilityType: r.utility_type,
        total: Number(r.total),
        count: Number(r.n),
      })),
      tenantArrears,
    };
}

router.get('/dashboard', canAccounting, async (req, res, next) => {
  const parsed = dashboardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return next(new ApiError(400, 'Période invalide', parsed.error.flatten().fieldErrors));
  }
  try {
    const result = await computeAccountingDashboard(req.user, parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/dashboard.pdf — rapport mensuel exportable pour le
// comptable (étape 18, demande directe de l'utilisateur) : même calcul que
// l'écran, mis en page pour être imprimé ou transmis (à la direction
// générale, ou à un comptable externe).
router.get('/dashboard.pdf', canAccounting, async (req, res, next) => {
  const parsed = dashboardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return next(new ApiError(400, 'Période invalide', parsed.error.flatten().fieldErrors));
  }
  try {
    const dashboard = await computeAccountingDashboard(req.user, parsed.data);
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: req.user.tenantId });
    if (!tenantRows[0]) throw new ApiError(404, 'Entreprise introuvable');
    streamAccountingReportPdf(res, { tenant: tenantRows[0], dashboard });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/arrears — centre de relance groupée (étape 10) : liste
// complète des locataires en retard sur tout le portefeuille (téléphone,
// bien/unité inclus pour construire les liens WhatsApp), tout le portefeuille
// et pas seulement la comptabilité — ouvert à `locataires` OU `comptabilite`.
router.get('/arrears', requireAnyPermission('locataires', 'comptabilite'), async (req, res, next) => {
  try {
    // Portée « Biens gérés » (étape 14) : un agent restreint ne relance que
    // les locataires de ses propres Biens.
    const scopeAgentId = await resolvePropertyScope(req.user);
    const arrears = await listPortfolioArrears(req.user.tenantId, scopeAgentId);
    res.json({
      arrears,
      total: arrears.reduce((sum, a) => sum + a.amountOwed, 0),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/predictive-alerts — alertes prédictives de retard
// (étape 13, idée n°4) : locataires actuellement à jour, échéance proche,
// mais historiquement en retard — pour relancer avant le retard, pas
// seulement après. Même permission que le centre de relance (`/arrears`).
router.get('/predictive-alerts', requireAnyPermission('locataires', 'comptabilite'), async (req, res, next) => {
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const alerts = await listPredictiveLateAlerts(req.user.tenantId, scopeAgentId);
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/rent-payments?from=&to= — classification : paiements des locataires.
router.get('/rent-payments', canAccounting, async (req, res, next) => {
  const parsed = dashboardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return next(new ApiError(400, 'Période invalide', parsed.error.flatten().fieldErrors));
  }
  const { from, to } = parsed.data;
  try {
    const [rows] = await pool.query(
      `SELECT rp.*, r.id AS renter_id, r.first_name AS renter_first_name, r.last_name AS renter_last_name,
              u.code AS unit_code, ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name, ru.role AS recorder_role
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
       JOIN renters r ON r.id = l.renter_id
       JOIN property_units u ON u.id = l.unit_id
       LEFT JOIN users ru ON ru.id = rp.recorded_by
       WHERE rp.tenant_id = :tenantId AND rp.paid_at BETWEEN :from AND :to
       ORDER BY rp.paid_at DESC, rp.id DESC`,
      { tenantId: req.user.tenantId, from, to },
    );
    res.json({
      payments: rows.map((p) => ({
        id: p.id,
        renter: { id: p.renter_id, firstName: p.renter_first_name, lastName: p.renter_last_name },
        unitCode: p.unit_code,
        coversMonth: p.covers_month,
        amount: Number(p.amount),
        paymentMethod: p.payment_method,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
        paidAt: isoDate(p.paid_at),
        recordedBy: toActor(p.recorder_first_name, p.recorder_last_name, p.recorder_role),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/owner-payouts?from=&to= — classification : versements aux propriétaires.
router.get('/owner-payouts', canAccounting, async (req, res, next) => {
  const parsed = dashboardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return next(new ApiError(400, 'Période invalide', parsed.error.flatten().fieldErrors));
  }
  const { from, to } = parsed.data;
  try {
    const [rows] = await pool.query(
      `SELECT op.*, o.id AS owner_id, o.name AS owner_name,
              ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name, ru.role AS recorder_role
       FROM owner_payouts op
       JOIN owners o ON o.id = op.owner_id
       LEFT JOIN users ru ON ru.id = op.recorded_by
       WHERE op.tenant_id = :tenantId AND op.paid_at BETWEEN :from AND :to
       ORDER BY op.paid_at DESC, op.id DESC`,
      { tenantId: req.user.tenantId, from, to },
    );
    res.json({
      payouts: rows.map((p) => ({
        id: p.id,
        owner: { id: p.owner_id, name: p.owner_name },
        periodLabel: p.period_label,
        amount: Number(p.amount),
        paymentMethod: p.payment_method,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
        paidAt: isoDate(p.paid_at),
        recordedBy: toActor(p.recorder_first_name, p.recorder_last_name, p.recorder_role),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/periods — mois déjà clôturés (traçabilité).
router.get('/periods', requireAnyPermission('comptabilite', 'charges'), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT ap.period, ap.closed_at, ap.forced, u.first_name, u.last_name, u.role
       FROM accounting_periods ap JOIN users u ON u.id = ap.closed_by
       WHERE ap.tenant_id = :tenantId ORDER BY ap.period DESC`,
      { tenantId: req.user.tenantId },
    );
    res.json({
      periods: rows.map((r) => ({
        period: r.period,
        closedAt: r.closed_at,
        closedBy: toActor(r.first_name, r.last_name, r.role),
        forced: !!r.forced,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/accounting/periods — clôturer un mois (DG uniquement). Définitif :
// plus aucune écriture financière (paiement, versement, dépense, charge) ne
// pourra ensuite être créée, modifiée ou supprimée pour ce mois.
//
// La clôture n'est plus une date choisie à l'aveugle : un mois n'est proposé
// comme sûr (« clôturable ») qu'une fois l'échéance de loyer la plus tardive
// des baux actifs de ce mois, plus une marge de sécurité, passée. Le DG peut
// tout de même clôturer plus tôt (`force: true`) — cas réel de gestion — mais
// cette clôture anticipée reste tracée (`forced`) et n'est acceptée que si le
// client a explicitement confirmé après avoir vu l'avertissement (sans
// `force`, une clôture pas encore clôturable est refusée avec le détail
// nécessaire pour construire cet avertissement).
router.post('/periods', requireRole('dg'), async (req, res, next) => {
  const parsed = closePeriodSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { period, force } = parsed.data;

  try {
    const [existing] = await pool.query(
      'SELECT id FROM accounting_periods WHERE tenant_id = :tenantId AND period = :period LIMIT 1',
      { tenantId: req.user.tenantId, period },
    );
    if (existing[0]) throw new ApiError(409, 'Ce mois est déjà clôturé.');

    const closability = await getPeriodClosability(req.user.tenantId, period);
    if (!closability.isClosable && !force) {
      throw new ApiError(
        409,
        `Ce mois n'est pas encore clôturable en toute sécurité (à partir du ${closability.closableFrom}).`,
        {
          closableFrom: closability.closableFrom,
          maxDueDay: closability.maxDueDay,
          pendingLeases: closability.pendingLeases,
        },
      );
    }
    const forced = !closability.isClosable && force;

    await pool.query(
      'INSERT INTO accounting_periods (tenant_id, period, closed_by, forced) VALUES (:tenantId, :period, :by, :forced)',
      { tenantId: req.user.tenantId, period, by: req.user.id, forced: forced ? 1 : 0 },
    );

    logger.info('Mois comptable clôturé', { tenantId: req.user.tenantId, period, by: req.user.id, forced });
    res.status(201).json({ period, forced });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/start-date — date de démarrage de la comptabilité (borne
// basse avant laquelle aucune écriture ne peut être créée). Lecture ouverte à
// comptabilite OU charges : un employé n'ayant que `charges` doit pouvoir
// savoir pourquoi son enregistrement sera refusé avant de le tenter, comme
// pour /periods.
router.get('/start-date', requireAnyPermission('comptabilite', 'charges'), async (req, res, next) => {
  try {
    const [[row]] = await pool.query(
      `SELECT t.accounting_start_date, t.accounting_start_date_set_at,
              u.first_name, u.last_name, u.role
       FROM tenants t
       LEFT JOIN users u ON u.id = t.accounting_start_date_set_by
       WHERE t.id = :tenantId LIMIT 1`,
      { tenantId: req.user.tenantId },
    );
    res.json({
      startDate: isoDate(row?.accounting_start_date),
      setAt: row?.accounting_start_date ? row.accounting_start_date_set_at : null,
      setBy: row?.accounting_start_date ? toActor(row.first_name, row.last_name, row.role) : null,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/accounting/start-date — définir/modifier la date de démarrage de
// la comptabilité (DG uniquement). `startDate: null` retire la restriction.
// Contrairement à la clôture d'un mois, cette date reste modifiable à tout
// moment : ce n'est pas un acte de traçabilité définitif, juste un paramètre.
router.patch('/start-date', requireRole('dg'), async (req, res, next) => {
  const parsed = startDateSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Date invalide', parsed.error.flatten().fieldErrors));
  }
  const { startDate } = parsed.data;

  try {
    await pool.query(
      `UPDATE tenants
       SET accounting_start_date = :startDate, accounting_start_date_set_by = :by, accounting_start_date_set_at = NOW()
       WHERE id = :tenantId`,
      { startDate, by: req.user.id, tenantId: req.user.tenantId },
    );
    logger.info('Date de démarrage comptabilité modifiée', { tenantId: req.user.tenantId, startDate, by: req.user.id });
    res.json({ startDate });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/deleted-entries — journal des suppressions (DG uniquement).
// Unifie les dépenses et charges SONEB/SBEE supprimées logiquement : détail,
// montant, auteur de la suppression et justification obligatoire — pour
// traçabilité, sans jamais réapparaître dans les totaux. Logique partagée
// avec le journal d'activité global (étape 10) via `services/activity.js`.
router.get('/deleted-entries', requireRole('dg'), async (req, res, next) => {
  try {
    const entries = await listDeletedEntries(req.user.tenantId);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
