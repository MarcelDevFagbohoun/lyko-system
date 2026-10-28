'use strict';

const { Router } = require('express');
const multer = require('multer');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission, requireAnyPermission, requireRole } = require('../middleware/auth');
const {
  createExpenseSchema,
  updateExpenseSchema,
  paySupplierExpenseSchema,
  dashboardQuerySchema,
  closePeriodSchema,
  deleteReasonSchema,
  startDateSchema,
} = require('../validators/expenses');
const {
  createFixedAssetSchema,
  payFixedAssetSchema,
  depreciateFixedAssetSchema,
  disposeFixedAssetSchema,
} = require('../validators/fixedAssets');
const { EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS } = require('../constants/expenses');
const { FIXED_ASSET_CATEGORIES } = require('../constants/fixedAssets');
const { toActor } = require('../utils/actor');
const { toProtectedFileUrl } = require('../utils/uploads');
const { isPeriodClosed, getTenantRhythm } = require('../services/accountingPeriods');
const {
  listPortfolioArrears,
  listPredictiveLateAlerts,
  computeRentMonthSummary,
  listRentMonthRenters,
  paymentPeriodKey,
} = require('../services/rentTracking');
const { listDeletedEntries } = require('../services/activity');
const { resolvePropertyScope } = require('../services/scope');
const { streamAccountingReportPdf } = require('../services/pdf');
const { getClosingOverview } = require('../services/closingOverview');
const { getCardDetail } = require('../services/accountingCardDetail');
const logger = require('../utils/logger');
const expensesService = require('../services/expenses');
const fixedAssetsService = require('../services/fixedAssets');
const { computeAccountingDashboard } = require('../services/accountingDashboard');
const { buildAccountingExport } = require('../services/accountingExport');
const registers = require('../services/accountingRegisters');
const accountingClosing = require('../services/accountingClosing');

const { getMonthBilan, getStoredBilan, MONTH_RE } = require('../services/monthBilan');
const { requireChargesEnabled } = require('../middleware/chargesModule');
const { isoDate, clampIsoDate } = require('../utils/dates');
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
// Écritures de dépenses/immobilisations : permission dédiée, distincte de la simple consultation.
const canRecordExpense = requirePermission('depenses_enregistrer');

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
  caution: 'Prélevé sur la caution',
};

function toPublicExpense(row) {
  return {
    id: row.id,
    category: row.category,
    label: row.label,
    amount: Number(row.amount),
    expenseDate: isoDate(row.expense_date),
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    paymentMethodLabel: row.payment_method ? PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method : null,
    paidAt: isoDate(row.paid_at),
    // Uniquement pour une dépense "à crédit" — `null` pour une dépense payée
    // immédiatement (comportement historique, jamais de fournisseur alors).
    supplierId: row.supplier_id ?? null,
    supplierName: row.supplier_name ?? null,
    notes: row.notes,
    receiptUrl: row.receipt_path ? toProtectedFileUrl(row.receipt_path) : null,
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

// Valeur nette comptable = coût d'acquisition − amortissements déjà
// ENREGISTRÉS (jamais une estimation théorique sur la durée totale — seuls
// les mois réellement saisis via POST /:id/depreciate comptent, même
// principe que le reste du module : rien n'est estimé, tout est tracé).
function toPublicFixedAsset(row) {
  const acquisitionCost = Number(row.acquisition_cost);
  const accumulatedDepreciation = Number(row.accumulated_depreciation ?? 0);
  return {
    id: row.id,
    label: row.label,
    category: row.category,
    acquisitionDate: isoDate(row.acquisition_date),
    acquisitionCost,
    usefulLifeYears: row.useful_life_years,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    paymentMethodLabel: row.payment_method ? PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method : null,
    paidAt: isoDate(row.paid_at),
    supplierId: row.supplier_id ?? null,
    supplierName: row.supplier_name ?? null,
    status: row.status,
    disposedAt: isoDate(row.disposed_at),
    disposedReason: row.disposed_reason ?? null,
    salePrice: row.disposed_sale_price != null ? Number(row.disposed_sale_price) : null,
    accumulatedDepreciation,
    bookValue: acquisitionCost - accumulatedDepreciation,
    createdAt: row.created_at,
  };
}

// GET /api/accounting/meta — catalogues pour construire les formulaires.
router.get('/meta', canAccounting, (_req, res) => {
  res.json({
    categories: EXPENSE_CATEGORIES,
    paymentMethods: EXPENSE_PAYMENT_METHODS,
    fixedAssetCategories: FIXED_ASSET_CATEGORIES,
  });
});

// GET /api/accounting/expenses?from=&to=&category=&q= — journal des dépenses.
router.get('/expenses', canAccounting, async (req, res, next) => {
  try {
    const propertyId = Number(req.query.propertyId);
    const rows = await expensesService.listExpenses(req.user.tenantId, {
      from: clampIsoDate(req.query.from),
      to: clampIsoDate(req.query.to),
      category: typeof req.query.category === 'string' ? req.query.category : '',
      q: typeof req.query.q === 'string' ? req.query.q.trim() : '',
      propertyId,
    });
    res.json({ expenses: rows.map(toPublicExpense) });
  } catch (err) {
    next(err);
  }
});

// POST /api/accounting/expenses — enregistrer une dépense (+ justificatif optionnel).
router.post('/expenses', canAccounting, canRecordExpense, upload.single('receipt'), async (req, res, next) => {
  const parsed = createExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const expenseId = await expensesService.createExpense(req.user.tenantId, req.user.id, data, req.file);
    logger.info('Dépense enregistrée', { tenantId: req.user.tenantId, expenseId, amount: data.amount, by: req.user.id });
    res.status(201).json({ expenseId });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/accounting/expenses/:id — corriger une dépense (+ ajouter/remplacer son justificatif).
router.patch('/expenses/:id', canAccounting, canRecordExpense, upload.single('receipt'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const row = await expensesService.updateExpense(req.user.tenantId, id, parsed.data, req.file);
    res.json({ expense: toPublicExpense(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/accounting/expenses/:id/pay — régler une dépense "à crédit".
// Solde la dette envers le fournisseur (401) et sort la trésorerie —
// jamais une nouvelle charge (déjà comptabilisée à l'engagement).
router.post('/expenses/:id/pay', canAccounting, canRecordExpense, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = paySupplierExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    await expensesService.payExpense(req.user.tenantId, req.user.id, id, parsed.data);
    logger.info('Dépense à crédit réglée', { tenantId: req.user.tenantId, expenseId: id, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/suppliers — fournisseurs déjà utilisés (autocomplétion
// + total dû), pas un module CRM fournisseurs complet.
router.get('/suppliers', canAccounting, async (req, res, next) => {
  try {
    const rows = await expensesService.listSuppliers(req.user.tenantId);
    res.json({ suppliers: rows.map((r) => ({ id: r.id, name: r.name, totalOwed: Number(r.total_owed) })) });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/fixed-assets — registre des immobilisations du cabinet
// (matériel propre à l'agence — jamais les Biens gérés pour le compte des
// propriétaires, qui n'appartiennent pas au cabinet).
router.get('/fixed-assets', canAccounting, async (req, res, next) => {
  try {
    const rows = await fixedAssetsService.listFixedAssets(req.user.tenantId);
    res.json({ fixedAssets: rows.map(toPublicFixedAsset) });
  } catch (err) {
    next(err);
  }
});

// POST /api/accounting/fixed-assets — enregistrer une immobilisation. Même
// schéma "à crédit" que POST /expenses (get-or-create fournisseur par nom
// exact — voir le commentaire détaillé là-bas).
router.post('/fixed-assets', canAccounting, canRecordExpense, async (req, res, next) => {
  const parsed = createFixedAssetSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const fixedAssetId = await fixedAssetsService.createFixedAsset(req.user.tenantId, req.user.id, data);
    logger.info('Immobilisation enregistrée', {
      tenantId: req.user.tenantId,
      fixedAssetId,
      amount: data.acquisitionCost,
      by: req.user.id,
    });
    res.status(201).json({ fixedAssetId });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/fixed-assets/:id — détail d'une immobilisation, avec
// l'historique des mois d'amortissement déjà enregistrés.
router.get('/fixed-assets/:id', canAccounting, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const { row, depreciations } = await fixedAssetsService.getFixedAsset(req.user.tenantId, id);
    res.json({
      fixedAsset: toPublicFixedAsset(row),
      depreciations: depreciations.map((d) => ({
        period: d.period,
        amount: Number(d.amount),
        recordedBy: toActor(d.first_name, d.last_name, d.role),
        createdAt: d.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/accounting/fixed-assets/:id/pay — régler une immobilisation "à
// crédit". Solde la dette envers le fournisseur (481, jamais 401 — voir
// `reglement_fournisseur_investissement`) et sort la trésorerie, jamais une
// nouvelle charge (déjà comptabilisée à l'acquisition).
router.post('/fixed-assets/:id/pay', canAccounting, canRecordExpense, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = payFixedAssetSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    await fixedAssetsService.payFixedAsset(req.user.tenantId, req.user.id, id, parsed.data);
    logger.info('Immobilisation à crédit réglée', { tenantId: req.user.tenantId, fixedAssetId: id, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/accounting/fixed-assets/:id/depreciate — enregistrer un mois
// d'amortissement (acte SAISI, jamais un cron automatique — voir le
// commentaire de `fixed_asset_depreciations`, migration 049). Amortissement
// LINÉAIRE simple (coût ÷ durée ÷ 12) ; le prorata temporis du mois
// d'acquisition est configurable par entreprise (Comptabilité avancée →
// Règles comptables), voir services/gl/glDepreciationService.js.
router.post('/fixed-assets/:id/depreciate', canAccounting, canRecordExpense, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = depreciateFixedAssetSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { period } = parsed.data;

  try {
    const { depreciationId, amount, remainingBookValue } = await fixedAssetsService.depreciateFixedAsset(
      req.user.tenantId,
      req.user.id,
      id,
      period,
    );
    logger.info('Amortissement enregistré', { tenantId: req.user.tenantId, fixedAssetId: id, period, amount, by: req.user.id });
    res.status(201).json({ depreciationId, amount, remainingBookValue });
  } catch (err) {
    next(err);
  }
});

// POST /api/accounting/fixed-assets/:id/dispose — sortir une immobilisation
// du patrimoine (vente, rebut, perte). Bug corrigé (audit comptable du
// 30/09/2026) : cette action n'existait tout simplement pas — un bien
// disparu restait indéfiniment "actif" avec sa valeur résiduelle, faussant
// le bilan. Acte DÉFINITIF (comme une clôture de mois) : jamais de
// réouverture, une justification est exigée comme pour toute suppression
// de donnée comptable dans ce projet.
router.post('/fixed-assets/:id/dispose', canAccounting, canRecordExpense, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = disposeFixedAssetSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { disposedAt, reason } = parsed.data;
  const salePrice = parsed.data.salePrice ?? 0;

  try {
    const { accumulatedDepreciation, bookValue } = await fixedAssetsService.disposeFixedAsset(req.user.tenantId, req.user.id, id, {
      disposedAt,
      reason,
      salePrice,
      salePaymentMethod: parsed.data.salePaymentMethod,
    });
    logger.info('Immobilisation sortie du patrimoine', {
      tenantId: req.user.tenantId,
      fixedAssetId: id,
      disposedAt,
      accumulatedDepreciation,
      bookValue,
      by: req.user.id,
    });
    res.status(200).json({ fixedAssetId: id, disposedAt });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/accounting/expenses/:id — suppression logique d'une dépense mal
// saisie : la trace reste en base (visible du DG via /deleted-entries) avec
// une justification obligatoire, mais le montant sort des totaux/recettes.
router.delete('/expenses/:id', canAccounting, canRecordExpense, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = deleteReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  }
  const { reason } = parsed.data;

  try {
    await expensesService.deleteExpense(req.user.tenantId, req.user.id, id, reason);
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
// GET /api/accounting/card-detail?card=&from=&to= — détail daté d'une carte du tableau de bord (voir
// services/accountingCardDetail.js : mêmes filtres que `computeAccountingDashboard`).
router.get('/card-detail', canAccounting, async (req, res, next) => {
  const parsed = dashboardQuerySchema.safeParse(req.query);
  if (!parsed.success) return next(new ApiError(400, 'Période invalide', parsed.error.flatten().fieldErrors));
  try {
    const detail = await getCardDetail(req.user, String(req.query.card), parsed.data);
    if (!detail) return next(new ApiError(400, 'Carte inconnue'));
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

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

// GET /api/accounting/export.xlsx?from=&to= — registre comptable détaillé,
// une ligne par mouvement de trésorerie RÉELLEMENT enregistré (jamais un
// montant recalculé/estimé, contrairement aux impayés du tableau de bord) —
// pour un comptable externe qui doit rapprocher les comptes, distinct du
// rapport mensuel (`dashboard.pdf`) qui ne donne que des totaux agrégés.
// Réunit les 4 registres déjà exposés séparément à l'écran (loyers, versements,
// dépenses, charges SONEB/SBEE réglées) en un seul classeur chronologique,
// chacun étiqueté clairement plutôt que fondu dans un solde unique — en
// particulier les travaux facturés à un Bien restent visibles (le cabinet les
// paie physiquement) mais gardent une étiquette distincte d'une dépense de
// fonctionnement, cohérent avec la règle déjà appliquée par
// `computeAccountingDashboard` (jamais comptés dans le solde du cabinet).
router.get('/export.xlsx', canAccounting, async (req, res, next) => {
  const parsed = dashboardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return next(new ApiError(400, 'Période invalide', parsed.error.flatten().fieldErrors));
  }
  const { from, to } = parsed.data;
  const tenantId = req.user.tenantId;

  try {
    const { workbook, rowCount } = await buildAccountingExport(tenantId, { from, to });

    logger.info('Export comptable Excel généré', { tenantId, from, to, rows: rowCount, by: req.user.id });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="registre-comptable-${from}-au-${to}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/rent-month?month=AAAA-MM — encadré « Ce mois-ci » : loyers attendus,
// encaissés et restant à encaisser pour un mois de loyer, tous baux suivis confondus
// (voir `summarizeRentMonth`). Défaut : le mois en cours. Portée « Biens gérés » respectée.
router.get('/rent-month', canAccounting, async (req, res, next) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : currentMonth;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, 'Mois invalide (AAAA-MM)');

    const scopeAgentId = await resolvePropertyScope(req.user);
    const summary = await computeRentMonthSummary(req.user.tenantId, month, scopeAgentId);
    res.json({ ...summary, isCurrentMonth: month === currentMonth });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/rent-month/:month/renters — point financier de CHAQUE locataire pour ce mois
// (demande utilisateur, 2026-10-18 : cliquer un mois clôturé dans l'historique de clôture doit
// montrer le détail par locataire, pas seulement le total déjà affiché par `/rent-month` ci-dessus).
router.get('/rent-month/:month/renters', canAccounting, async (req, res, next) => {
  const month = req.params.month;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return next(new ApiError(400, 'Mois invalide (AAAA-MM)'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const renters = await listRentMonthRenters(req.user.tenantId, month, scopeAgentId);
    res.json({ month, renters });
  } catch (err) {
    next(err);
  }
});

// Bilan complet d'un mois clôturé : voir désormais `GET /api/accounting/month-bilan/:month`
// (`services/monthBilan.js`) — implémentation plus complète (solde d'ouverture/clôture par
// propriétaire, écart de réconciliation) construite en parallèle, qui a remplacé cette première
// version (`/rent-month/:month/bilan` + `getOwnerPayoutStatusAsOf`, retirées comme code mort).

// GET /api/accounting/month-bilan/:month — bilan détaillé d'un mois (entrées, sorties, par Bien, point
// propriétaires, point locataires à la fin du mois, dépenses, charges, contrôles). Mois clôturé : renvoie la
// PHOTO FIGÉE prise à la clôture (`source: 'snapshot'`) et signale par `drift` si une reconstruction avec les
// données actuelles donne un autre résultat (régularisation postérieure). Sinon `source: 'live'`.
router.get('/month-bilan/:month', canAccounting, async (req, res, next) => {
  const month = req.params.month;
  if (!MONTH_RE.test(month)) return next(new ApiError(400, 'Mois invalide (AAAA-MM)'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const live = await getMonthBilan(req.user.tenantId, month, { scopeAgentId });
    const closed = await isPeriodClosed(req.user.tenantId, `${month}-01`);
    const stored = closed ? await getStoredBilan(req.user.tenantId, month) : null;
    if (stored) {
      const key = (b) => JSON.stringify([b.treasury, b.cabinet, b.inflows.lines, b.outflows.lines]);
      return res.json({
        source: 'snapshot',
        frozenAt: stored.frozenAt,
        isClosed: true,
        drift: key(stored.snapshot) !== key(live),
        bilan: stored.snapshot,
        live,
      });
    }
    res.json({ source: 'live', isClosed: closed, drift: false, bilan: live });
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

// GET /api/accounting/utility-arrears — centre de relance groupée, mais pour
// les charges SONEB/SBEE impayées ou partiellement payées (étape 28) : le
// même principe que `/arrears` (loyer), jamais construit jusqu'ici pour les
// charges malgré le statut de règlement introduit à l'étape 23. Une ligne
// par FACTURE (pas par locataire) — contrairement au loyer, qui accumule
// mécaniquement mois après mois, une facture SONEB/SBEE est un événement
// plus ponctuel ; regrouper aurait ajouté de la complexité de message pour
// un cas rare (plusieurs factures impayées à la fois pour le même locataire).
// « En retard » = jours écoulés depuis `billed_at`, faute d'échéance propre à
// une facture ponctuelle (contrairement au loyer, qui a un `rent_due_day`) —
// jamais un simple retard « recalculé », toujours basé sur une date déjà
// enregistrée. Permission : `charges` (module propriétaire de la donnée) OU
// `comptabilite`, même logique que `/arrears` avec `locataires`/`comptabilite`.
router.get('/utility-arrears', requireChargesEnabled, requireAnyPermission('charges', 'comptabilite'), async (req, res, next) => {
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const rows = await registers.listUtilityArrearsRows(req.user.tenantId, scopeAgentId);

    const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const arrears = rows.map((r) => {
      const billedAt = isoDate(r.billed_at);
      const [y, m, d] = billedAt.split('-').map(Number);
      const daysLate = Math.floor((todayUtc - Date.UTC(y, m - 1, d)) / 86_400_000);
      return {
        chargeId: r.charge_id,
        leaseId: r.lease_id,
        renterId: r.renter_id,
        renterName: `${r.first_name} ${r.last_name}`,
        phone: r.phone,
        unitCode: r.unit_code,
        propertyCode: r.property_code,
        utilityType: r.utility_type,
        status: r.status,
        billedAt,
        daysLate,
        amountOwed: Number(r.amount) - Number(r.paid_total),
        lastRelanceAt: r.last_relance_at ? isoDate(r.last_relance_at) : null,
      };
    });

    res.json({ arrears, total: arrears.reduce((sum, a) => sum + a.amountOwed, 0) });
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
    const rows = await registers.listRentPaymentRows(req.user.tenantId, from, to);
    res.json({
      payments: rows.map((p) => ({
        id: p.id,
        renter: { id: p.renter_id, firstName: p.renter_first_name, lastName: p.renter_last_name },
        unitCode: p.unit_code,
        coversMonth: paymentPeriodKey(p),
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
    const rows = await registers.listOwnerPayoutRows(req.user.tenantId, from, to);
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

// GET /api/accounting/closing-overview — page Clôture (étape 54) : prochain mois à clôturer, frise
// des mois et liste de vérifications (voir `services/closingOverview.js`). Lecture seule.
router.get('/closing-overview', canAccounting, async (req, res, next) => {
  try {
    res.json(await getClosingOverview(req.user.tenantId));
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/periods — mois déjà clôturés (traçabilité).
router.get('/periods', requireAnyPermission('comptabilite', 'charges'), async (req, res, next) => {
  try {
    const rows = await accountingClosing.listClosedPeriods(req.user.tenantId);
    res.json({
      periods: rows.map((r) => ({
        // `period` reste 'AAAA-MM' pour une période clôturée au rythme calendaire ; null pour un
        // autre rythme — l'écran libelle alors la période par `periodStart`/`periodEnd`.
        period: r.period,
        periodStart: isoDate(r.period_start),
        periodEnd: isoDate(r.period_end),
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

  try {
    const result = await accountingClosing.closePeriod(req.user.tenantId, req.user.id, parsed.data);

    logger.info('Période comptable clôturée', {
      tenantId: req.user.tenantId,
      period: result.period,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      by: req.user.id,
      forced: result.forced,
    });
    res.status(201).json(result);
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
    const row = await accountingClosing.getStartDateRow(req.user.tenantId);
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
    await accountingClosing.setStartDate(req.user.tenantId, req.user.id, startDate);
    logger.info('Date de démarrage comptabilité modifiée', { tenantId: req.user.tenantId, startDate, by: req.user.id });
    res.json({ startDate });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounting/rhythm — rythme de période de ce tenant (étape 1/5, 2026-10-16). Lecture
// ouverte à comptabilite OU charges. Le rythme n'est plus modifiable depuis l'étape 53 (retour à la
// clôture par mois civil, migration 089) : toujours 'calendaire', lu par les formulaires de bail.
router.get('/rhythm', requireAnyPermission('comptabilite', 'charges'), async (req, res, next) => {
  try {
    const rhythm = await getTenantRhythm(req.user.tenantId);
    res.json({ mode: rhythm.mode, startDay: rhythm.startDay });
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
