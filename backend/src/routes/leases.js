'use strict';

const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');
const {
  createPaymentSchema,
  endLeaseSchema,
  createLateFeeSchema,
  createOpeningDebtPaymentSchema,
} = require('../validators/renters');
const {
  startInspectionReportSchema,
  updateInspectionDraftSchema,
  updateMoveOutDraftSchema,
} = require('../validators/inspections');
const { UNIT_DESIGNATIONS } = require('../constants/properties');
const { computeArrears, allocateRentPayment } = require('../services/rentTracking');
const { streamReceiptPdf, streamMoveOutPdf } = require('../services/pdf');
const { assertPeriodOpen } = require('../services/accountingPeriods');
const { resolvePropertyScope } = require('../services/scope');
const { getOrCreateIssuance, ensureShareToken } = require('../services/documentIssuance');
const { genererEcriture, isModuleActive } = require('../services/gl/glPostingService');
const { toActor } = require('../utils/actor');
const {
  cloneMasterZones,
  cloneZonesFrom,
  normalizeStoredItems,
  findItem,
  getMissingConditionLabels,
  sumDeductions,
  recomputeItemDeductions,
  toPublicInspectionReport,
  toPublicMoveOutReport,
} = require('../services/inspection');
const { assertUploadType, randomFileName } = require('../utils/uploads');
const { generatePortalToken, hashToken } = require('../utils/tokens');
const logger = require('../utils/logger');

// Un lien de paiement expire par défaut sous 48h — assez pour laisser le
// temps au locataire de le recevoir et payer, sans rester valide indéfiniment.
const PAYMENT_LINK_TTL_HOURS = 48;

const router = Router();
router.use(requireAuth);

const canLocataires = requirePermission('locataires');
const canEtatsDesLieux = requirePermission('etats_des_lieux');
// Paiements et quittances : agent (locataires) ET comptable (paiements/factures, section 5).
const canPayments = requireAnyPermission('locataires', 'comptabilite');

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));

/**
 * Charge un bail appartenant à l'entreprise courante (+ unité/bien), ou lève
 * 404. `scopeAgentId` (étape 14) : un agent restreint à un sous-ensemble du
 * portefeuille n'accède qu'aux baux dont le Bien lui est attribué — 404,
 * jamais 403, pour ne jamais confirmer qu'un bail existe hors de sa portée.
 * Seul point d'entrée de ce routeur vers un bail : suffit à couvrir tous les
 * appels ci-dessous (paiements, quittances, états des lieux).
 */
async function loadLease(conn, tenantId, leaseId, scopeAgentId = null) {
  const [rows] = await conn.query(
    `SELECT l.*, u.id AS unit_id, u.code AS unit_code, u.designation, u.designation_custom,
            p.id AS property_id, p.address AS property_address, p.agent_id AS property_agent_id
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.id = :leaseId AND l.tenant_id = :tenantId LIMIT 1`,
    { leaseId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Bail introuvable');
  if (scopeAgentId != null && Number(rows[0].property_agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Bail introuvable');
  }
  const row = rows[0];
  row.property_label =
    row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
  return row;
}

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
// Photo par élément d'état des lieux : mêmes contraintes que les photos de
// Bien (étape 5/9). Signatures (finalisation) : PNG issu d'un canvas, léger.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
});
const signaturesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
});

const INSPECTION_REPORT_SELECT = `
  t.*, cu.first_name AS conductor_first_name, cu.last_name AS conductor_last_name, cu.role AS conductor_role,
  fu.first_name AS finalizer_first_name, fu.last_name AS finalizer_last_name, fu.role AS finalizer_role
`;

/** `reportsTable` : toujours l'un des deux littéraux ci-dessous, jamais une valeur venue du client. */
async function loadInspectionReportRow(conn, reportsTable, leaseId) {
  const [rows] = await conn.query(
    `SELECT ${INSPECTION_REPORT_SELECT} FROM ${reportsTable} t
     LEFT JOIN users cu ON cu.id = t.conducted_by
     LEFT JOIN users fu ON fu.id = t.finalized_by
     WHERE t.lease_id = :leaseId LIMIT 1`,
    { leaseId },
  );
  return rows[0] ?? null;
}

function assertDraft(report, label) {
  if (!report) throw new ApiError(404, `Aucun ${label} pour ce bail`);
  if (report.status !== 'draft') {
    throw new ApiError(409, `Cette fiche est déjà finalisée et ne peut plus être modifiée.`);
  }
}

/** Enregistre un fichier téléversé (multer memoryStorage) sous `uploads/tenants/<id>/inspections/<leaseId>/`. */
async function saveInspectionFile(tenantId, leaseId, file, baseName, label) {
  const ext = assertUploadType(file, { label });
  const dir = path.join(UPLOADS_ROOT, `tenants/${tenantId}/inspections/${leaseId}`);
  await fs.mkdir(dir, { recursive: true });
  const rel = `tenants/${tenantId}/inspections/${leaseId}/${randomFileName(baseName, ext)}`;
  await fs.writeFile(path.join(UPLOADS_ROOT, rel), file.buffer);
  return rel;
}

async function deleteInspectionFile(rel) {
  if (!rel) return;
  await fs.unlink(path.join(UPLOADS_ROOT, rel)).catch(() => {});
}

async function nextReceiptNumber(conn, tenantId) {
  const year = new Date().getFullYear();
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM receipts WHERE tenant_id = :tenantId AND receipt_number LIKE :prefix`,
    { tenantId, prefix: `QT-${year}-%` },
  );
  const seq = Number(rows[0].n) + 1;
  return `QT-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Cœur commun de l'enregistrement d'un paiement de loyer : verrouille le
 * bail, calcule l'allocation multi-mois, insère les lignes `rent_payments` +
 * `receipts`. Seul endroit qui insère dans `rent_payments` — utilisé par la
 * route manuelle (staff) ci-dessous ET par les chemins KKiaPay (portail,
 * lien de paiement, webhook), jamais dupliqué.
 *
 * `recordedBy` : `null` pour un paiement confirmé par KKiaPay (aucun employé
 * ne l'a saisi). `kkiapayTransactionId`, s'il est fourni, n'est attaché qu'à
 * la PREMIÈRE ligne créée (la colonne est UNIQUE — un paiement qui se
 * répartit sur plusieurs mois ne doit pas tenter d'insérer la même
 * référence KKiaPay deux fois) ; il suffit à identifier la transaction pour
 * l'idempotence, vérifiée en amont par l'appelant avant même d'arriver ici.
 * Appelant responsable du verrou de transaction (`conn.beginTransaction()`)
 * et du `SELECT ... FOR UPDATE` sur le bail avant d'appeler cette fonction.
 */
async function recordRentPayment(
  conn,
  { tenantId, lease, coversMonth, amount, paymentMethod, paidAt, notes, recordedBy, kkiapayTransactionId = null },
) {
  // Nom du locataire pour le libellé de l'écriture comptable uniquement —
  // `lease` (chargé par `loadLease`) ne porte pas cette jointure.
  const [renterRows] = await conn.query('SELECT first_name, last_name FROM renters WHERE id = :id LIMIT 1', {
    id: lease.renter_id,
  });
  const renterName = renterRows[0] ? `${renterRows[0].first_name} ${renterRows[0].last_name}` : 'Locataire';

  const [payRows] = await conn.query('SELECT covers_month FROM rent_payments WHERE lease_id = :leaseId', {
    leaseId: lease.id,
  });
  const startDate =
    lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
  const arrears = computeArrears({
    startDate,
    createdAt: lease.created_at,
    upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
    rentDueDay: lease.rent_due_day,
    payments: payRows.map((r) => ({ coversMonth: r.covers_month })),
  });
  const startMonth = coversMonth && coversMonth >= arrears.nextDueMonth ? coversMonth : arrears.nextDueMonth;

  const { fullMonths, partialAmount, monthsCovered, allocations } = allocateRentPayment({
    nextDueMonth: startMonth,
    monthlyRent: lease.monthly_rent,
    amount,
  });

  const created = [];
  for (const [i, alloc] of allocations.entries()) {
    const [paymentResult] = await conn.query(
      `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, notes, recorded_by, kkiapay_transaction_id)
       VALUES (:tenantId, :leaseId, :coversMonth, :amount, :method, :paidAt, :notes, :recordedBy, :kkiapayTransactionId)`,
      {
        tenantId,
        leaseId: lease.id,
        coversMonth: alloc.coversMonth,
        amount: alloc.amount,
        method: paymentMethod,
        paidAt,
        notes: notes ?? null,
        recordedBy: recordedBy ?? null,
        kkiapayTransactionId: i === 0 ? kkiapayTransactionId : null,
      },
    );
    const paymentId = paymentResult.insertId;
    const receiptNumber = await nextReceiptNumber(conn, tenantId);
    const [receiptResult] = await conn.query(
      `INSERT INTO receipts (tenant_id, payment_id, receipt_number) VALUES (:tenantId, :paymentId, :number)`,
      { tenantId, paymentId, number: receiptNumber },
    );

    // Module comptabilité SYSCOHADA (nouveau) — génère la contrepartie en
    // partie double dans LA MÊME transaction, SEULEMENT si l'entreprise a
    // activé le module (`isModuleActive`) : une entreprise qui ne l'a jamais
    // configuré continue de fonctionner exactement comme avant, jamais
    // bloquée par une comptabilité qu'elle n'a pas mise en place. Une fois
    // activé, une écriture qui échoue (exercice clôturé...) fait échouer le
    // paiement aussi, jamais l'inverse.
    if (await isModuleActive(conn, tenantId)) {
      await genererEcriture(conn, {
        tenantId,
        operationType: 'loyer_encaisse',
        entryDate: paidAt,
        amount: alloc.amount,
        paymentMethod,
        narrationVars: { mois: alloc.coversMonth, locataire: renterName },
        sourceTable: 'rent_payments',
        sourceId: paymentId,
        createdBy: recordedBy,
        context: { leaseId: lease.id },
      });
    }

    created.push({
      paymentId,
      coversMonth: alloc.coversMonth,
      amount: alloc.amount,
      isPartial: alloc.isPartial,
      receipt: { id: receiptResult.insertId, number: receiptNumber },
    });
  }

  return { startMonth, fullMonths, partialAmount, monthsCovered, payments: created };
}

// PATCH /api/leases/:leaseId — mettre fin à un bail (libère l'unité).
router.patch('/:leaseId', canLocataires, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = endLeaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(conn, req.user.tenantId, leaseId, scopeAgentId);
    if (lease.status !== 'active') throw new ApiError(400, 'Ce bail est déjà terminé');

    await conn.beginTransaction();
    await conn.query('UPDATE leases SET status = :status, end_date = :endDate WHERE id = :id', {
      status: 'ended',
      endDate: parsed.data.endDate,
      id: leaseId,
    });
    await conn.query("UPDATE property_units SET status = 'libre' WHERE id = :id", {
      id: lease.unit_id,
    });
    await conn.commit();

    logger.info('Bail terminé', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/leases/:leaseId/payments — registre des paiements du bail.
router.get('/:leaseId/payments', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const [payments] = await pool.query(
      'SELECT * FROM rent_payments WHERE lease_id = :leaseId ORDER BY paid_at DESC, id DESC',
      { leaseId },
    );
    res.json({ payments });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/payments — enregistrer un paiement (génère la quittance).
router.post('/:leaseId/payments', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(conn, req.user.tenantId, leaseId, scopeAgentId);
    if (lease.status !== 'active') throw new ApiError(400, 'Ce bail est terminé, impossible d\'ajouter un paiement');
    await assertPeriodOpen(req.user.tenantId, data.paidAt);

    await conn.beginTransaction();

    // Sérialise les enregistrements concurrents sur ce bail : un double-clic ou
    // deux requêtes simultanées ne pourront pas insérer chacune sans voir l'autre.
    await conn.query('SELECT id FROM leases WHERE id = :leaseId FOR UPDATE', { leaseId });

    // Garde anti-doublon : un paiement pour CE MÊME MOIS (calculé comme le
    // ferait `recordRentPayment`), même date et même mode, enregistré il y a
    // moins de 2 minutes sur ce bail → très probablement un double-clic sur
    // le même versement (le verrou FOR UPDATE ci-dessus empêche déjà un
    // doublon strictement simultané, cette garde couvre une resoumission un
    // peu plus tardive). Un mois différent reste permis : rattraper
    // plusieurs mois de retard à la suite, y compris avec le même mode de
    // règlement répété, est un usage normal.
    const [payRowsForGuard] = await conn.query('SELECT covers_month FROM rent_payments WHERE lease_id = :leaseId', {
      leaseId,
    });
    const startDateForGuard =
      lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
    const arrearsForGuard = computeArrears({
      startDate: startDateForGuard,
      createdAt: lease.created_at,
      upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
      rentDueDay: lease.rent_due_day,
      payments: payRowsForGuard.map((r) => ({ coversMonth: r.covers_month })),
    });
    const startMonthForGuard =
      data.coversMonth && data.coversMonth >= arrearsForGuard.nextDueMonth
        ? data.coversMonth
        : arrearsForGuard.nextDueMonth;
    const [recent] = await conn.query(
      `SELECT id FROM rent_payments
       WHERE lease_id = :leaseId AND covers_month = :startMonth AND paid_at = :paidAt AND payment_method = :method
         AND created_at > (NOW() - INTERVAL 2 MINUTE)
       LIMIT 1`,
      { leaseId, startMonth: startMonthForGuard, paidAt: data.paidAt, method: data.paymentMethod },
    );
    if (recent.length > 0) {
      throw new ApiError(409, 'Un paiement identique vient d\'être enregistré. Rechargez la page pour le voir.');
    }

    const { fullMonths, partialAmount, monthsCovered, payments: created } = await recordRentPayment(conn, {
      tenantId: req.user.tenantId,
      lease,
      coversMonth: data.coversMonth,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      paidAt: data.paidAt,
      notes: data.notes,
      recordedBy: req.user.id,
    });

    await conn.commit();

    logger.info('Paiement(s) de loyer enregistré(s)', {
      tenantId: req.user.tenantId,
      leaseId,
      count: created.length,
      totalAmount: data.amount,
      by: req.user.id,
    });

    const first = created[0];
    res.status(201).json({
      // Compat : premier paiement au niveau racine.
      paymentId: first.paymentId,
      receipt: first.receipt,
      // Répartition multi-mois.
      monthsCovered,
      fullMonths,
      partialAmount,
      payments: created,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/leases/:leaseId/late-fees — pénalités déjà appliquées sur ce bail.
router.get('/:leaseId/late-fees', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const [rows] = await pool.query(
      `SELECT lf.*, u.first_name, u.last_name, u.role
       FROM late_fees lf LEFT JOIN users u ON u.id = lf.applied_by
       WHERE lf.lease_id = :leaseId ORDER BY lf.applied_at DESC, lf.id DESC`,
      { leaseId },
    );
    res.json({
      lateFees: rows.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        appliedAt: r.applied_at instanceof Date ? r.applied_at.toISOString().slice(0, 10) : String(r.applied_at).slice(0, 10),
        reason: r.reason,
        appliedBy: toActor(r.first_name, r.last_name, r.role),
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/late-fees — appliquer une pénalité de retard.
// Montant TOUJOURS saisi à la main (voir validators/renters.js) : jamais de
// barème automatique inventé. N'affecte jamais le montant du loyer dû
// (`computeArrears`, inchangé) — c'est une dette SÉPARÉE, réglée par le
// locataire quand il le souhaite (aucun suivi de règlement dédié en V1 :
// visible dans Comptabilité avancée, compte 411, comme toute créance).
router.post('/:leaseId/late-fees', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createLateFeeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(conn, req.user.tenantId, leaseId, scopeAgentId);
    if (lease.status !== 'active') throw new ApiError(400, 'Ce bail est terminé, impossible d\'appliquer une pénalité');

    const [renterRows] = await conn.query('SELECT first_name, last_name FROM renters WHERE id = :id', {
      id: lease.renter_id,
    });
    const renterName = renterRows[0] ? `${renterRows[0].first_name} ${renterRows[0].last_name}` : 'Locataire';

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO late_fees (tenant_id, lease_id, amount, applied_at, reason, applied_by)
       VALUES (:tenantId, :leaseId, :amount, :appliedAt, :reason, :by)`,
      {
        tenantId: req.user.tenantId,
        leaseId,
        amount: data.amount,
        appliedAt: data.appliedAt,
        reason: data.reason,
        by: req.user.id,
      },
    );
    const lateFeeId = result.insertId;

    if (await isModuleActive(conn, req.user.tenantId)) {
      await genererEcriture(conn, {
        tenantId: req.user.tenantId,
        operationType: 'penalite_retard',
        entryDate: data.appliedAt,
        amount: data.amount,
        narrationVars: { locataire: renterName },
        sourceTable: 'late_fees',
        sourceId: lateFeeId,
        createdBy: req.user.id,
        context: { leaseId },
      });
    }

    await conn.commit();
    logger.info('Pénalité de retard appliquée', { tenantId: req.user.tenantId, leaseId, lateFeeId, amount: data.amount, by: req.user.id });
    res.status(201).json({ lateFeeId });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/leases/:leaseId/balance-snapshots — historique des soldes figés
// à chaque clôture de mois (audit, voir `lease_balance_snapshots`).
router.get('/:leaseId/balance-snapshots', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const [rows] = await pool.query(
      'SELECT period, amount_due, created_at FROM lease_balance_snapshots WHERE lease_id = :leaseId ORDER BY period DESC',
      { leaseId },
    );
    res.json({
      snapshots: rows.map((r) => ({ period: r.period, amountDue: Number(r.amount_due), createdAt: r.created_at })),
    });
  } catch (err) {
    next(err);
  }
});

/** Solde restant de la dette initiale d'un bail (montant déclaré − paiements déjà enregistrés). */
async function getOpeningDebtRemaining(conn, tenantId, lease) {
  const [rows] = await conn.query(
    'SELECT COALESCE(SUM(amount), 0) AS paid FROM lease_opening_debt_payments WHERE lease_id = :leaseId AND tenant_id = :tenantId',
    { leaseId: lease.id, tenantId },
  );
  return Number(lease.opening_debt_amount) - Number(rows[0].paid);
}

// POST /api/leases/:leaseId/opening-debt/payments — régler (totalement ou
// partiellement) la dette initiale déclarée à la création du bail. Table
// dédiée plutôt qu'un ajout à `rent_payments` : cette dette n'est rattachée
// à aucun mois de loyer précis, jamais de quittance mensuelle à générer.
// Si le module comptabilité avancée est actif, génère la MÊME répartition
// qu'un encaissement de loyer normal (commission cabinet + reste au
// propriétaire, `dette_initiale_encaissee` dans le seed) — décision
// explicite de l'utilisateur : cette dette est traitée comme un loyer en
// retard finalement collecté, pas une opération à part.
router.post('/:leaseId/opening-debt/payments', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createOpeningDebtPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(conn, req.user.tenantId, leaseId, scopeAgentId);
    await assertPeriodOpen(req.user.tenantId, data.paidAt);

    const [renterRows] = await conn.query('SELECT first_name, last_name FROM renters WHERE id = :id', {
      id: lease.renter_id,
    });
    const renterName = renterRows[0] ? `${renterRows[0].first_name} ${renterRows[0].last_name}` : 'Locataire';

    await conn.beginTransaction();

    // Verrouille le bail : deux règlements simultanés ne doivent jamais
    // pouvoir dépasser ensemble le solde restant (même principe que le
    // verrou sur le paiement de loyer ci-dessus).
    await conn.query('SELECT id FROM leases WHERE id = :leaseId FOR UPDATE', { leaseId });

    const remaining = await getOpeningDebtRemaining(conn, req.user.tenantId, lease);
    if (remaining <= 0) {
      throw new ApiError(409, 'Aucun impayé restant à l\'entrée pour ce bail');
    }
    if (data.amount > remaining) {
      throw new ApiError(400, `Le montant dépasse le solde restant (${remaining} FCFA)`);
    }

    const [result] = await conn.query(
      `INSERT INTO lease_opening_debt_payments (tenant_id, lease_id, amount, payment_method, paid_at, notes, recorded_by)
       VALUES (:tenantId, :leaseId, :amount, :method, :paidAt, :notes, :recordedBy)`,
      {
        tenantId: req.user.tenantId,
        leaseId,
        amount: data.amount,
        method: data.paymentMethod,
        paidAt: data.paidAt,
        notes: data.notes,
        recordedBy: req.user.id,
      },
    );
    const paymentId = result.insertId;

    if (await isModuleActive(conn, req.user.tenantId)) {
      await genererEcriture(conn, {
        tenantId: req.user.tenantId,
        operationType: 'dette_initiale_encaissee',
        entryDate: data.paidAt,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        narrationVars: { locataire: renterName },
        sourceTable: 'lease_opening_debt_payments',
        sourceId: paymentId,
        createdBy: req.user.id,
        context: { leaseId },
      });
    }

    await conn.commit();
    logger.info('Dette initiale réglée', { tenantId: req.user.tenantId, leaseId, paymentId, amount: data.amount, by: req.user.id });
    res.status(201).json({ paymentId, remaining: remaining - data.amount });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/leases/:leaseId/payments/:paymentId/receipt.pdf
router.get('/:leaseId/payments/:paymentId/receipt.pdf', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const paymentId = Number(req.params.paymentId);
  if (!Number.isInteger(leaseId) || !Number.isInteger(paymentId)) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);

    const [paymentRows] = await pool.query(
      'SELECT * FROM rent_payments WHERE id = :paymentId AND lease_id = :leaseId LIMIT 1',
      { paymentId, leaseId },
    );
    if (!paymentRows[0]) throw new ApiError(404, 'Paiement introuvable');

    const [receiptRows] = await pool.query('SELECT * FROM receipts WHERE payment_id = :paymentId LIMIT 1', {
      paymentId,
    });
    if (!receiptRows[0]) throw new ApiError(404, 'Quittance introuvable');

    const [renterRows] = await pool.query('SELECT * FROM renters WHERE id = :id LIMIT 1', {
      id: lease.renter_id,
    });
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', {
      id: req.user.tenantId,
    });
    // Cachet/signature de l'employé qui a réellement encaissé ce paiement
    // (pas forcément celui qui télécharge la quittance aujourd'hui).
    const [issuerRows] = await pool.query('SELECT * FROM users WHERE id = :id LIMIT 1', {
      id: paymentRows[0].recorded_by,
    });

    streamReceiptPdf(res, {
      tenant: tenantRows[0],
      renter: renterRows[0],
      property: lease,
      lease,
      payment: paymentRows[0],
      receipt: receiptRows[0],
      issuer: issuerRows[0] || null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/payments/:paymentId/receipt-link — lien de
// partage direct de CETTE quittance (envoi automatique par WhatsApp juste
// après le paiement, voir frontend PaymentRegister). Idempotent : rappeler
// cette route pour la même quittance renvoie toujours le même lien.
router.post('/:leaseId/payments/:paymentId/receipt-link', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const paymentId = Number(req.params.paymentId);
  if (!Number.isInteger(leaseId) || !Number.isInteger(paymentId)) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);

    const [paymentRows] = await pool.query(
      'SELECT id FROM rent_payments WHERE id = :paymentId AND lease_id = :leaseId LIMIT 1',
      { paymentId, leaseId },
    );
    if (!paymentRows[0]) throw new ApiError(404, 'Paiement introuvable');

    const issuance = await getOrCreateIssuance(req.user.tenantId, 'quittance', paymentId);
    const token = await ensureShareToken(issuance);
    // Pas un chemin de page frontend (contrairement aux liens de portail/de
    // paiement) : ce token pointe directement sur le flux PDF du backend
    // (`GET /api/recu/:token`), sans page Next.js intermédiaire.
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/move-in-report — état des lieux d'entrée (le cas échéant).
router.get('/:leaseId/move-in-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    res.json({ report: toPublicInspectionReport(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/move-in-report — démarre le BROUILLON de l'état des
// lieux d'entrée (une fois par bail), amorcé avec les zones/éléments standards.
router.post('/:leaseId/move-in-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = startInspectionReportSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);

    const [existing] = await pool.query('SELECT id FROM move_in_reports WHERE lease_id = :leaseId LIMIT 1', {
      leaseId,
    });
    if (existing[0]) throw new ApiError(409, 'Un état des lieux existe déjà pour ce bail');

    const zones = cloneMasterZones();
    const [result] = await pool.query(
      `INSERT INTO move_in_reports (tenant_id, lease_id, conducted_at, items, status, conducted_by)
       VALUES (:tenantId, :leaseId, :conductedAt, :items, 'draft', :by)`,
      {
        tenantId: req.user.tenantId,
        leaseId,
        conductedAt: parsed.data.conductedAt || new Date().toISOString().slice(0, 10),
        items: JSON.stringify({ zones }),
        by: req.user.id,
      },
    );

    logger.info('État des lieux d’entrée démarré (brouillon)', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
    const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    res.status(201).json({ report: toPublicInspectionReport(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/leases/:leaseId/move-in-report — enregistre le brouillon (zones,
// éléments — y compris personnalisés —, notes). Refusé une fois finalisée.
router.patch('/:leaseId/move-in-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateInspectionDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const report = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    assertDraft(report, 'état des lieux d’entrée');

    await pool.query(
      `UPDATE move_in_reports SET items = :items, general_notes = :notes${data.conductedAt ? ', conducted_at = :conductedAt' : ''}
       WHERE lease_id = :leaseId`,
      {
        items: JSON.stringify({ zones: data.zones }),
        notes: data.generalNotes,
        conductedAt: data.conductedAt,
        leaseId,
      },
    );

    const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    res.json({ report: toPublicInspectionReport(row) });
  } catch (err) {
    next(err);
  }
});

// POST/DELETE .../move-in-report/items/:zoneKey/:itemKey/photo — photo d'un élément.
router.post(
  '/:leaseId/move-in-report/items/:zoneKey/:itemKey/photo',
  canEtatsDesLieux,
  photoUpload.single('photo'),
  async (req, res, next) => {
    const leaseId = Number(req.params.leaseId);
    if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));
    if (!req.file) return next(new ApiError(400, 'Photo requise'));

    try {
      const scopeAgentId = await resolvePropertyScope(req.user);
      await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
      const report = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
      assertDraft(report, 'état des lieux d’entrée');

      const zones = normalizeStoredItems(report.items);
      const found = findItem(zones, req.params.zoneKey, req.params.itemKey);
      if (!found) throw new ApiError(404, 'Élément introuvable sur cette fiche');

      const rel = await saveInspectionFile(req.user.tenantId, leaseId, req.file, 'photo', 'Photo');
      const oldPath = found.item.photoUrl;
      found.item.photoUrl = `/uploads/${rel}`;

      await pool.query('UPDATE move_in_reports SET items = :items WHERE lease_id = :leaseId', {
        items: JSON.stringify({ zones }),
        leaseId,
      });
      if (oldPath) await deleteInspectionFile(oldPath.replace(/^\/uploads\//, ''));

      const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
      res.json({ report: toPublicInspectionReport(row) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:leaseId/move-in-report/items/:zoneKey/:itemKey/photo', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const report = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    assertDraft(report, 'état des lieux d’entrée');

    const zones = normalizeStoredItems(report.items);
    const found = findItem(zones, req.params.zoneKey, req.params.itemKey);
    if (!found) throw new ApiError(404, 'Élément introuvable sur cette fiche');

    const oldPath = found.item.photoUrl;
    found.item.photoUrl = null;
    await pool.query('UPDATE move_in_reports SET items = :items WHERE lease_id = :leaseId', {
      items: JSON.stringify({ zones }),
      leaseId,
    });
    if (oldPath) await deleteInspectionFile(oldPath.replace(/^\/uploads\//, ''));

    const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    res.json({ report: toPublicInspectionReport(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/move-in-report/finalize — verrouille la fiche
// (exige tous les états renseignés + les deux signatures).
router.post(
  '/:leaseId/move-in-report/finalize',
  canEtatsDesLieux,
  signaturesUpload.fields([
    { name: 'tenantSignature', maxCount: 1 },
    { name: 'agentSignature', maxCount: 1 },
  ]),
  async (req, res, next) => {
    const leaseId = Number(req.params.leaseId);
    if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

    const tenantSignatureFile = req.files?.tenantSignature?.[0];
    const agentSignatureFile = req.files?.agentSignature?.[0];
    if (!tenantSignatureFile || !agentSignatureFile) {
      return next(new ApiError(400, 'Signature du locataire et de l’agent requises'));
    }

    try {
      const scopeAgentId = await resolvePropertyScope(req.user);
      await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
      const report = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
      assertDraft(report, 'état des lieux d’entrée');

      const zones = normalizeStoredItems(report.items);
      const missing = getMissingConditionLabels(zones);
      if (missing.length > 0) {
        throw new ApiError(400, `État manquant pour : ${missing.join(', ')}`);
      }

      const tenantSignaturePath = await saveInspectionFile(req.user.tenantId, leaseId, tenantSignatureFile, 'signature-locataire', 'Signature');
      const agentSignaturePath = await saveInspectionFile(req.user.tenantId, leaseId, agentSignatureFile, 'signature-agent', 'Signature');

      await pool.query(
        `UPDATE move_in_reports
         SET status = 'finalized', finalized_at = NOW(), finalized_by = :by,
             tenant_signature_path = :tenantSig, agent_signature_path = :agentSig
         WHERE lease_id = :leaseId`,
        { by: req.user.id, tenantSig: tenantSignaturePath, agentSig: agentSignaturePath, leaseId },
      );

      logger.info('État des lieux d’entrée finalisé', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
      const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
      res.json({ report: toPublicInspectionReport(row) });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/leases/:leaseId/move-out-report — état des lieux de sortie (le cas
// échéant) + arriérés en cours (contexte pour aider à chiffrer les retenues).
router.get('/:leaseId/move-out-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);

    let arrears = null;
    if (lease.status === 'active') {
      const [payments] = await pool.query(
        'SELECT covers_month FROM rent_payments WHERE lease_id = :leaseId',
        { leaseId },
      );
      arrears = computeArrears({
        startDate: lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date,
        createdAt: lease.created_at,
        upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
        rentDueDay: lease.rent_due_day,
        payments: payments.map((p) => ({ coversMonth: p.covers_month })),
      });
    }

    res.json({ report: toPublicMoveOutReport(row), arrears });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/move-out-report — démarre le BROUILLON de l'état
// des lieux de sortie, amorcé avec les zones/éléments de la fiche d'entrée
// (mêmes `key`, pour que la comparaison automatique puisse faire correspondre
// les postes un par un) — ou, à défaut de fiche d'entrée, les zones standards.
router.post('/:leaseId/move-out-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = startInspectionReportSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    if (lease.status !== 'active') throw new ApiError(400, 'Ce bail est déjà terminé');

    const [existing] = await pool.query('SELECT id FROM move_out_reports WHERE lease_id = :leaseId LIMIT 1', {
      leaseId,
    });
    if (existing[0]) throw new ApiError(409, 'Un état des lieux de sortie existe déjà pour ce bail');

    const moveInRow = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    const zones = moveInRow ? cloneZonesFrom(normalizeStoredItems(moveInRow.items)) : cloneMasterZones();
    const depositAmount = Number(lease.deposit_amount);

    const [result] = await pool.query(
      `INSERT INTO move_out_reports
         (tenant_id, lease_id, conducted_at, items, status, deposit_amount, total_deductions, net_refund, conducted_by)
       VALUES (:tenantId, :leaseId, :conductedAt, :items, 'draft', :depositAmount, 0, :depositAmount, :by)`,
      {
        tenantId: req.user.tenantId,
        leaseId,
        conductedAt: parsed.data.conductedAt || new Date().toISOString().slice(0, 10),
        items: JSON.stringify({ zones }),
        depositAmount,
        by: req.user.id,
      },
    );

    logger.info('État des lieux de sortie démarré (brouillon)', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    res.status(201).json({ report: toPublicMoveOutReport(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/leases/:leaseId/move-out-report — enregistre le brouillon (zones,
// éléments, retenues par élément, autres retenues, notes).
router.patch('/:leaseId/move-out-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateMoveOutDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    assertDraft(report, 'état des lieux de sortie');

    // Un élément avec des lignes de facturation (catalogue) voit son montant
    // de retenue RECALCULÉ à partir de ces lignes, jamais celui envoyé tel
    // quel par le client (voir `computeItemDeduction`).
    recomputeItemDeductions(data.zones);
    const itemsDeductions = sumDeductions(data.zones);
    const totalDeductions = itemsDeductions + data.otherDeductionsAmount;
    const netRefund = Math.max(0, Number(report.deposit_amount) - totalDeductions);

    await pool.query(
      `UPDATE move_out_reports
       SET items = :items, general_notes = :notes,
           other_deductions_amount = :otherAmount, other_deductions_note = :otherNote,
           total_deductions = :totalDeductions, net_refund = :netRefund
           ${data.conductedAt ? ', conducted_at = :conductedAt' : ''}
       WHERE lease_id = :leaseId`,
      {
        items: JSON.stringify({ zones: data.zones }),
        notes: data.generalNotes,
        otherAmount: data.otherDeductionsAmount,
        otherNote: data.otherDeductionsNote,
        totalDeductions,
        netRefund,
        conductedAt: data.conductedAt,
        leaseId,
      },
    );

    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    res.json({ report: toPublicMoveOutReport(row) });
  } catch (err) {
    next(err);
  }
});

// POST/DELETE .../move-out-report/items/:zoneKey/:itemKey/photo — photo d'un élément.
router.post(
  '/:leaseId/move-out-report/items/:zoneKey/:itemKey/photo',
  canEtatsDesLieux,
  photoUpload.single('photo'),
  async (req, res, next) => {
    const leaseId = Number(req.params.leaseId);
    if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));
    if (!req.file) return next(new ApiError(400, 'Photo requise'));

    try {
      const scopeAgentId = await resolvePropertyScope(req.user);
      await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
      const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
      assertDraft(report, 'état des lieux de sortie');

      const zones = normalizeStoredItems(report.items);
      const found = findItem(zones, req.params.zoneKey, req.params.itemKey);
      if (!found) throw new ApiError(404, 'Élément introuvable sur cette fiche');

      const rel = await saveInspectionFile(req.user.tenantId, leaseId, req.file, 'photo', 'Photo');
      const oldPath = found.item.photoUrl;
      found.item.photoUrl = `/uploads/${rel}`;

      await pool.query('UPDATE move_out_reports SET items = :items WHERE lease_id = :leaseId', {
        items: JSON.stringify({ zones }),
        leaseId,
      });
      if (oldPath) await deleteInspectionFile(oldPath.replace(/^\/uploads\//, ''));

      const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
      res.json({ report: toPublicMoveOutReport(row) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:leaseId/move-out-report/items/:zoneKey/:itemKey/photo', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    assertDraft(report, 'état des lieux de sortie');

    const zones = normalizeStoredItems(report.items);
    const found = findItem(zones, req.params.zoneKey, req.params.itemKey);
    if (!found) throw new ApiError(404, 'Élément introuvable sur cette fiche');

    const oldPath = found.item.photoUrl;
    found.item.photoUrl = null;
    await pool.query('UPDATE move_out_reports SET items = :items WHERE lease_id = :leaseId', {
      items: JSON.stringify({ zones }),
      leaseId,
    });
    if (oldPath) await deleteInspectionFile(oldPath.replace(/^\/uploads\//, ''));

    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    res.json({ report: toPublicMoveOutReport(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/move-out-report/finalize — verrouille la fiche
// (exige tous les états renseignés + les deux signatures), recalcule le
// décompte de caution à partir des données persistées, termine le bail et
// libère l'unité — tout dans la même transaction.
router.post(
  '/:leaseId/move-out-report/finalize',
  canEtatsDesLieux,
  signaturesUpload.fields([
    { name: 'tenantSignature', maxCount: 1 },
    { name: 'agentSignature', maxCount: 1 },
  ]),
  async (req, res, next) => {
    const leaseId = Number(req.params.leaseId);
    if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

    const tenantSignatureFile = req.files?.tenantSignature?.[0];
    const agentSignatureFile = req.files?.agentSignature?.[0];
    if (!tenantSignatureFile || !agentSignatureFile) {
      return next(new ApiError(400, 'Signature du locataire et de l’agent requises'));
    }

    const conn = await pool.getConnection();
    try {
      const scopeAgentId = await resolvePropertyScope(req.user);
      const lease = await loadLease(conn, req.user.tenantId, leaseId, scopeAgentId);
      const report = await loadInspectionReportRow(conn, 'move_out_reports', leaseId);
      assertDraft(report, 'état des lieux de sortie');
      if (lease.status !== 'active') throw new ApiError(400, 'Ce bail est déjà terminé');

      const zones = normalizeStoredItems(report.items);
      const missing = getMissingConditionLabels(zones);
      if (missing.length > 0) {
        throw new ApiError(400, `État manquant pour : ${missing.join(', ')}`);
      }

      const itemsDeductions = sumDeductions(zones);
      const totalDeductions = itemsDeductions + Number(report.other_deductions_amount);
      const depositAmount = Number(report.deposit_amount);
      const netRefund = Math.max(0, depositAmount - totalDeductions);

      // Module comptabilité SYSCOHADA (nouveau) : mode de règlement requis
      // seulement s'il reste réellement quelque chose à reverser (une
      // caution intégralement absorbée par des retenues n'implique aucun
      // mouvement de trésorerie). Voir routes/renters.js `recordDepositReceived`
      // pour la réception — même principe, symétrique.
      const refundPaymentMethod = typeof req.body?.refundPaymentMethod === 'string' ? req.body.refundPaymentMethod : '';
      const REFUND_METHODS = ['especes', 'mobile_money', 'virement', 'cheque'];
      if (netRefund > 0 && !REFUND_METHODS.includes(refundPaymentMethod)) {
        throw new ApiError(400, 'Mode de règlement requis pour la restitution de la caution');
      }

      const tenantSignaturePath = await saveInspectionFile(req.user.tenantId, leaseId, tenantSignatureFile, 'signature-locataire', 'Signature');
      const agentSignaturePath = await saveInspectionFile(req.user.tenantId, leaseId, agentSignatureFile, 'signature-agent', 'Signature');

      await conn.beginTransaction();

      await conn.query(
        `UPDATE move_out_reports
         SET status = 'finalized', finalized_at = NOW(), finalized_by = :by,
             tenant_signature_path = :tenantSig, agent_signature_path = :agentSig,
             total_deductions = :totalDeductions, net_refund = :netRefund, refund_payment_method = :refundMethod
         WHERE lease_id = :leaseId`,
        {
          by: req.user.id,
          tenantSig: tenantSignaturePath,
          agentSig: agentSignaturePath,
          totalDeductions,
          netRefund,
          refundMethod: netRefund > 0 ? refundPaymentMethod : null,
          leaseId,
        },
      );
      await conn.query(
        "UPDATE leases SET status = 'ended', end_date = :endDate, deposit_status = 'returned' WHERE id = :id",
        { endDate: report.conducted_at, id: leaseId },
      );
      await conn.query("UPDATE property_units SET status = 'libre' WHERE id = :id", { id: lease.unit_id });

      // Module comptabilité SYSCOHADA (nouveau) — restitution SIMPLE
      // uniquement (aucune retenue) : le sort comptable d'une retenue sur
      // caution (produit du cabinet ? compensation pour le propriétaire ?)
      // est un choix de jugement comptable non tranché (voir seed, règle
      // `caution_restituee`) — jamais inventé ici. Avec retenue, la
      // caution reste "à régulariser manuellement" (signalé dans la réponse).
      let depositAccountingNote = null;
      if (await isModuleActive(conn, req.user.tenantId)) {
        if (totalDeductions === 0 && netRefund > 0) {
          const [renterRows] = await conn.query(
            'SELECT r.first_name, r.last_name FROM leases l JOIN renters r ON r.id = l.renter_id WHERE l.id = :leaseId LIMIT 1',
            { leaseId },
          );
          const renterName = renterRows[0] ? `${renterRows[0].first_name} ${renterRows[0].last_name}` : 'Locataire';
          await genererEcriture(conn, {
            tenantId: req.user.tenantId,
            operationType: 'caution_restituee',
            entryDate: report.conducted_at,
            amount: netRefund,
            paymentMethod: refundPaymentMethod,
            narrationVars: { locataire: renterName },
            sourceTable: 'move_out_reports',
            sourceId: report.id,
            createdBy: req.user.id,
            context: { leaseId },
          });
        } else if (depositAmount > 0) {
          depositAccountingNote =
            'Caution avec retenue : à régulariser manuellement dans Comptabilité avancée → Journal → Écriture diverse (le sort comptable d\'une retenue sur caution n\'est pas encore automatisé).';
        }
      }

      await conn.commit();

      logger.info('Sortie de locataire finalisée', {
        tenantId: req.user.tenantId,
        leaseId,
        totalDeductions,
        netRefund,
        by: req.user.id,
      });
      const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
      res.json({ report: toPublicMoveOutReport(row), depositAccountingNote });
    } catch (err) {
      await conn.rollback().catch(() => {});
      next(err);
    } finally {
      conn.release();
    }
  },
);

// GET /api/leases/:leaseId/move-out-report.pdf — PV de sortie & décompte de caution.
router.get('/:leaseId/move-out-report.pdf', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);

    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    if (!row) throw new ApiError(404, "Aucun état des lieux de sortie pour ce bail");
    if (row.status !== 'finalized') {
      throw new ApiError(400, 'Cette fiche doit être finalisée (signée) avant de générer le PV.');
    }

    const [renterRows] = await pool.query('SELECT * FROM renters WHERE id = :id LIMIT 1', { id: lease.renter_id });
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', {
      id: req.user.tenantId,
    });

    // Fiche d'entrée : pour expliquer, à côté de chaque élément facturé, la
    // transition d'état qui a motivé la facturation ("Bon état → Mauvais
    // état"). Sans fiche d'entrée (rare — bail créé avant l'état des lieux
    // par zones), le PV affiche simplement l'état de sortie, sans comparaison.
    const moveInRow = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    const moveInZones = moveInRow ? normalizeStoredItems(moveInRow.items) : [];

    streamMoveOutPdf(res, {
      tenant: tenantRows[0],
      renter: renterRows[0],
      property: lease,
      lease,
      report: toPublicMoveOutReport(row),
      moveInZones,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/payment-links — génère un lien de paiement KKiaPay
// à envoyer à la main (WhatsApp) à un locataire sans portail actif. Même
// schéma de révélation unique que POST /:id/portal-link (renters.js) : seule
// l'empreinte du token est conservée, le lien en clair n'est renvoyé qu'ici.
router.post('/:leaseId/payment-links', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    if (lease.status !== 'active') throw new ApiError(400, 'Ce bail est terminé');

    const [[tenant]] = await pool.query('SELECT kkiapay_enabled FROM tenants WHERE id = :id LIMIT 1', {
      id: req.user.tenantId,
    });
    if (!tenant?.kkiapay_enabled) {
      throw new ApiError(400, 'Le paiement en ligne (KKiaPay) n\'est pas activé pour votre entreprise (Réglages).');
    }

    // Montant : celui fourni, sinon un mois de loyer (le cas d'usage courant
    // — envoyer un lien pour l'échéance du mois, pas nécessairement tout le
    // retard accumulé, que le personnel ajuste au besoin).
    let amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      amount = Number(lease.monthly_rent);
    }

    const token = generatePortalToken();
    const [result] = await pool.query(
      `INSERT INTO payment_links (tenant_id, kind, lease_id, amount, token_hash, created_by, expires_at)
       VALUES (:tenantId, 'loyer', :leaseId, :amount, :hash, :by, DATE_ADD(NOW(), INTERVAL :ttl HOUR))`,
      { tenantId: req.user.tenantId, leaseId, amount, hash: hashToken(token), by: req.user.id, ttl: PAYMENT_LINK_TTL_HOURS },
    );

    logger.info('Lien de paiement (loyer) généré', {
      tenantId: req.user.tenantId,
      leaseId,
      linkId: result.insertId,
      amount,
      by: req.user.id,
    });
    res.status(201).json({ token, path: `/payer/${token}`, amount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
// Réutilisés par portal.js (paiement KKiaPay depuis le portail locataire) et
// paymentLinks.js (lien de paiement généré par le personnel) — voir le
// commentaire au-dessus de `recordRentPayment` : seul point d'insertion
// dans `rent_payments`, jamais dupliqué.
module.exports.loadLease = loadLease;
module.exports.recordRentPayment = recordRentPayment;
