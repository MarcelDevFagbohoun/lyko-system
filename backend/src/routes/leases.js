'use strict';

const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const {
  createPaymentSchema,
  deletePaymentReasonSchema,
  endLeaseSchema,
  createLateFeeSchema,
  createLateFeePaymentSchema,
  createOpeningDebtPaymentSchema,
  updateContractSchema,
} = require('../validators/renters');
const {
  startInspectionReportSchema,
  updateInspectionDraftSchema,
  updateMoveOutDraftSchema,
  reopenInspectionReportSchema,
} = require('../validators/inspections');
const { computeArrears, allocateRentPayment, computeRentOwed } = require('../services/rentTracking');
const { claimIdempotencyKey, hasRecentIdenticalRentPayment, DUPLICATE_MESSAGE } = require('../services/paymentGuards');
const { streamReceiptPdf, streamEntryReceiptPdf, streamMoveOutPdf, streamMoveInPdf, streamLeaseContractPdf } = require('../services/pdf');
const { buildContractData, loadContractRow, toPublicContract } = require('../services/leaseContract');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('../services/accountingPeriods');
const { resolvePropertyScope } = require('../services/scope');
const { getOrCreateIssuance, ensureShareToken } = require('../services/documentIssuance');
const { genererEcriture, isModuleActive } = require('../services/gl/glPostingService');
const { extourneEcriture } = require('../services/gl/glReversalService');
const { getEscrowBalances } = require('../services/commission');
const { computeMoveOutStatement } = require('../services/moveOutStatement');
const { resolveOwnerFromLease } = require('../services/gl/glAccountResolver');
const {
  listLeaseDeposits,
  checkAdditionalDepositRefunds,
  finalizeAdditionalDeposits,
} = require('../services/leaseDeposits');
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
  snapshotForCorrection,
  diffInspectionReport,
} = require('../services/inspection');
const { assertUploadType, randomFileName, toProtectedFileUrl, stripFileUrlPrefix } = require('../utils/uploads');
const { generatePortalToken, hashToken } = require('../utils/tokens');
const logger = require('../utils/logger');
const { loadLease, recordRentPayment } = require('../services/rentPayments');
const { notifyRentPaymentsRecorded } = require('../services/payments/notify');

// Un lien de paiement expire par défaut sous 48h — assez pour laisser le
// temps au locataire de le recevoir et payer, sans rester valide indéfiniment.
const PAYMENT_LINK_TTL_HOURS = 48;

const router = Router();
router.use(requireAuth);

const canLocataires = requirePermission('locataires');
const canEtatsDesLieux = requirePermission('etats_des_lieux');
// Réouverture d'une fiche finalisée (étape 48, correction) : DG uniquement —
// même restriction que le catalogue de prix de dégradation.
const canReopenInspection = requireRole('dg');
// Marquer une régularisation comptable manuelle réglée : la comptabilité,
// jamais un agent restreint aux locataires (n'a rien à voir avec le journal).
const canRegularizeGl = requirePermission('comptabilite');
// Paiements et quittances : agent (locataires) ET comptable (paiements/factures, section 5).
// Enregistrer un versement de locataire : permission dédiée (la simple fiche locataire ne suffit plus).
const canPayments = requirePermission('loyers_encaisser');

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
  fu.first_name AS finalizer_first_name, fu.last_name AS finalizer_last_name, fu.role AS finalizer_role,
  ru.first_name AS reopener_first_name, ru.last_name AS reopener_last_name, ru.role AS reopener_role
`;

// move_out_reports uniquement (colonnes absentes de move_in_reports) — la
// jointure reste dans une clause à part pour ne pas casser move_in_reports.
const MOVE_OUT_REGULARIZER_SELECT = `, gu.first_name AS regularizer_first_name, gu.last_name AS regularizer_last_name, gu.role AS regularizer_role`;
const MOVE_OUT_REGULARIZER_JOIN = `LEFT JOIN users gu ON gu.id = t.gl_regularized_by`;

/** `reportsTable` : toujours l'un des deux littéraux ci-dessous, jamais une valeur venue du client. */
async function loadInspectionReportRow(conn, reportsTable, leaseId) {
  const isMoveOut = reportsTable === 'move_out_reports';
  const [rows] = await conn.query(
    `SELECT ${INSPECTION_REPORT_SELECT}${isMoveOut ? MOVE_OUT_REGULARIZER_SELECT : ''} FROM ${reportsTable} t
     LEFT JOIN users cu ON cu.id = t.conducted_by
     LEFT JOIN users fu ON fu.id = t.finalized_by
     LEFT JOIN users ru ON ru.id = t.reopened_by
     ${isMoveOut ? MOVE_OUT_REGULARIZER_JOIN : ''}
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

/** Symétrique de `assertDraft` — pour les routes qui n'ont de sens QUE sur une fiche finalisée (réouverture, PDF). */
function assertFinalized(report, label) {
  if (!report) throw new ApiError(404, `Aucun ${label} pour ce bail`);
  if (report.status !== 'finalized') {
    throw new ApiError(400, `Cette fiche n'est pas encore finalisée.`);
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

// PATCH /api/leases/:leaseId — mettre fin à un bail (libère l'unité).
//
// Bug corrigé (audit comptable du 30/09/2026) : cette route terminait un
// bail sans jamais toucher à ses cautions (`deposit_status` restait `held`
// indéfiniment) — et une fois `status !== 'active'`, l'état des lieux de
// sortie (seule voie qui régularise réellement les cautions, voir
// `finalizeAdditionalDeposits` plus bas) devient DÉFINITIVEMENT
// inaccessible pour ce bail (il exige `status === 'active'`). Un raccourci
// pour un cas légitime (bail sans aucune caution en jeu) devenait donc un
// piège pour le cas courant. Corrigé : refuse ce raccourci dès qu'une
// caution — loyer ou SBEE/SONEB/peinture — est encore `held`, et renvoie
// vers le circuit de sortie normal (état des lieux) qui les régularise
// TOUTES dans la même transaction que la fin du bail.
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

    if (Number(lease.deposit_amount) > 0 && lease.deposit_status === 'held') {
      throw new ApiError(
        409,
        'La caution de ce bail est encore à régulariser — terminez le bail via un état des lieux de sortie (Locataires → Sortie), pas ce raccourci.',
      );
    }
    const [[heldAdditional]] = await conn.query(
      "SELECT COUNT(*) AS n FROM lease_deposits WHERE lease_id = :leaseId AND status = 'held'",
      { leaseId },
    );
    if (Number(heldAdditional.n) > 0) {
      throw new ApiError(
        409,
        'Une caution supplémentaire (SBEE/SONEB/peinture) de ce bail est encore à régulariser — terminez le bail via un état des lieux de sortie (Locataires → Sortie), pas ce raccourci.',
      );
    }

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
      'SELECT * FROM rent_payments WHERE lease_id = :leaseId AND deleted_at IS NULL ORDER BY paid_at DESC, id DESC',
      { leaseId },
    );
    res.json({ payments });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/leases/:leaseId/payments/:paymentId — annuler un paiement de
// loyer mal saisi (audit comptable, anomalie A3 : aucune voie de correction
// n'existait avant). Suppression LOGIQUE, jamais physique (justification
// obligatoire, comme les dépenses/charges depuis la migration 016) — le
// paiement reste consultable, mais disparaît des arriérés/recette/tableau
// de bord. Si une écriture GL existe déjà, génère son extourne dans LA
// MÊME transaction (jamais de simple suppression de l'écriture).
router.delete('/:leaseId/payments/:paymentId', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const paymentId = Number(req.params.paymentId);
  if (!Number.isInteger(leaseId) || !Number.isInteger(paymentId)) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  const parsed = deletePaymentReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  }
  const { reason } = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(conn, req.user.tenantId, leaseId, scopeAgentId);

    const [paymentRows] = await conn.query(
      'SELECT * FROM rent_payments WHERE id = :paymentId AND lease_id = :leaseId AND tenant_id = :tenantId LIMIT 1',
      { paymentId, leaseId, tenantId: req.user.tenantId },
    );
    if (!paymentRows[0]) throw new ApiError(404, 'Paiement introuvable');
    if (paymentRows[0].deleted_at) throw new ApiError(409, 'Ce paiement est déjà annulé');

    await assertPeriodOpen(req.user.tenantId, paymentRows[0].paid_at);

    // Bug corrigé (audit comptable du 30/09/2026) : cette annulation ne
    // vérifiait jamais son impact sur le solde séquestre du propriétaire —
    // si ce loyer avait déjà servi de base à un versement, l'annuler après
    // coup pouvait faire passer le solde séquestre SOUS ZÉRO, silencieusement
    // (rien ne bloquait, rien n'alertait). Verrouille la fiche du
    // propriétaire (même principe que `assertPayoutWithinBalance`, appelé
    // pour un NOUVEAU versement) avant de décider.
    // Propriétaire EN VIGUEUR à la date du paiement annulé (pas forcément l'actuel) : c'est son
    // solde séquestre, pas celui du propriétaire courant du Bien, que ce loyer a réellement affecté.
    const owner = await resolveOwnerFromLease(conn, req.user.tenantId, leaseId, paymentRows[0].paid_at);

    // Bug corrigé (audit fermeture du mois, point 5, 16/10/2026) : SI une écriture GL validée existe
    // pour ce paiement, son extourne plus bas est datée AUJOURD'HUI (date de l'écriture MIROIR
    // elle-même, jamais celle du paiement annulé, déjà vérifiée ci-dessus) — jamais vérifiée contre la
    // clôture du mois jusqu'ici. Même principe que le correctif déjà en place sur l'extourne MANUELLE.
    const todayIso = new Date().toISOString().slice(0, 10);
    const [[existingGlEntry]] = await conn.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :tenantId AND source_table = 'rent_payments' AND source_id = :paymentId AND status = 'validee' LIMIT 1",
      { tenantId: req.user.tenantId, paymentId },
    );
    if (existingGlEntry) await assertPeriodOpen(req.user.tenantId, todayIso);

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — la vérification ci-dessus (avant `beginTransaction`)
    // n'empêchait pas une clôture de mois de se glisser entre les deux.
    await assertPeriodOpenLocked(conn, req.user.tenantId, paymentRows[0].paid_at);
    if (existingGlEntry) await assertPeriodOpenLocked(conn, req.user.tenantId, todayIso);
    await conn.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId FOR UPDATE', {
      id: owner.id,
      tenantId: req.user.tenantId,
    });

    await conn.query(
      'UPDATE rent_payments SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason WHERE id = :id',
      { by: req.user.id, reason, id: paymentId },
    );

    // Relit le solde séquestre SOUS CE VERROU, avec l'annulation déjà
    // appliquée dans CETTE transaction (visible ici, pas encore commitée) —
    // si ce loyer avait déjà été versé au propriétaire, l'annuler ferait
    // passer son solde sous zéro : on refuse plutôt que de laisser un
    // décalage invisible entre ce qui a été versé et ce qui a réellement
    // été encaissé.
    const balancesAfterCancel = await getEscrowBalances(req.user.tenantId, conn);
    const ownerBalanceAfterCancel = balancesAfterCancel.get(owner.id)?.balance ?? 0;
    if (ownerBalanceAfterCancel < 0) {
      throw new ApiError(
        409,
        `Impossible d'annuler ce paiement : ce montant a déjà été versé à ${owner.name} (le solde séquestre passerait à ${ownerBalanceAfterCancel} FCFA). Régularisez d'abord ce versement.`,
      );
    }

    const [glEntryRows] = await conn.query(
      "SELECT id, status FROM gl_entries WHERE tenant_id = :tenantId AND source_table = 'rent_payments' AND source_id = :paymentId LIMIT 1",
      { tenantId: req.user.tenantId, paymentId },
    );
    if (glEntryRows[0] && glEntryRows[0].status === 'validee') {
      await extourneEcriture(conn, {
        tenantId: req.user.tenantId,
        entryId: glEntryRows[0].id,
        entryDate: new Date().toISOString().slice(0, 10),
        userId: req.user.id,
        reason: `Paiement annulé — ${reason}`,
      });
    }

    await conn.commit();
    logger.info('Paiement de loyer annulé', { tenantId: req.user.tenantId, leaseId, paymentId, by: req.user.id, reason });
    res.status(204).send();
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
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
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, req.user.tenantId, data.paidAt);

    // Sérialise les enregistrements concurrents sur ce bail : un double-clic ou
    // deux requêtes simultanées ne pourront pas insérer chacune sans voir l'autre.
    await conn.query('SELECT id FROM leases WHERE id = :leaseId FOR UPDATE', { leaseId });

    // Garde anti-doublon (étape 36). Voie normale : une clé d'idempotence jointe à l'envoi,
    // réclamée ici dans la transaction — un vrai doublon (rejeu de la file hors-ligne après une
    // réponse perdue, nouvelle tentative réseau) est refusé, mais deux paiements VOULUS ne sont
    // jamais confondus, même de montants égaux le même jour avec le même mode (deux moitiés d'un
    // loyer, par exemple). Envoi SANS clé (ancien client) : heuristique héritée, qui compare
    // désormais aussi le MONTANT — elle refusait à tort de payer le reste d'un mois partiel juste
    // après un premier versement. (Le verrou FOR UPDATE ci-dessus sérialise déjà les envois
    // strictement simultanés ; un mois différent reste toujours permis.)
    if (data.idempotencyKey) {
      await claimIdempotencyKey(conn, req.user.tenantId, 'rent_payment', data.idempotencyKey);
    } else {
      const isCalendaireForGuard = lease.rent_due_day != null;
      const rhythmForGuard = { mode: isCalendaireForGuard ? 'calendaire' : 'jour_fixe' };
      const [payRowsForGuard] = await conn.query(
        'SELECT covers_month, covers_period_start, amount FROM rent_payments WHERE lease_id = :leaseId AND deleted_at IS NULL',
        { leaseId },
      );
      const startDateForGuard =
        lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
      const arrearsForGuard = computeArrears({
        startDate: startDateForGuard,
        createdAt: lease.created_at,
        upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
        rentDueDay: lease.rent_due_day,
        rentDueOffsetDays: lease.rent_due_offset_days,
        rentTiming: lease.rent_timing,
        monthlyRent: lease.monthly_rent,
        entryProration: lease.entry_proration,
        payments: payRowsForGuard.map((r) => ({
          coversMonth: isCalendaireForGuard
            ? r.covers_month
            : r.covers_period_start instanceof Date
              ? r.covers_period_start.toISOString().slice(0, 10)
              : String(r.covers_period_start).slice(0, 10),
          amount: Number(r.amount),
        })),
        rhythm: rhythmForGuard,
      });
      const startMonthForGuard =
        data.coversMonth && data.coversMonth >= arrearsForGuard.nextDueMonth
          ? data.coversMonth
          : arrearsForGuard.nextDueMonth;
      // Montant de la PREMIÈRE écriture que ce paiement créerait (même répartition que `recordRentPayment`).
      const firstAllocation = allocateRentPayment({
        nextDueMonth: startMonthForGuard,
        monthlyRent: lease.monthly_rent,
        alreadyPaidForNextDueMonth: startMonthForGuard === arrearsForGuard.nextDueMonth ? arrearsForGuard.paidForNextDueMonth : 0,
        amount: data.amount,
        rhythm: rhythmForGuard,
      }).allocations[0];
      if (
        firstAllocation &&
        (await hasRecentIdenticalRentPayment(conn, {
          leaseId,
          coversPeriodStart: isCalendaireForGuard ? `${startMonthForGuard}-01` : startMonthForGuard,
          paidAt: data.paidAt,
          paymentMethod: data.paymentMethod,
          amount: firstAllocation.amount,
        }))
      ) {
        throw new ApiError(409, DUPLICATE_MESSAGE, { code: ['duplicate_request'] });
      }
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
    notifyRentPaymentsRecorded(req.user.tenantId, created.map((c) => c.paymentId));

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

// GET /api/leases/:leaseId/late-fees — pénalités déjà appliquées sur ce bail, avec leur solde de
// règlement (étape 44bis : une pénalité peut désormais être réglée, totalement ou partiellement).
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
    const lateFeeIds = rows.map((r) => r.id);
    let paidById = new Map();
    if (lateFeeIds.length > 0) {
      const placeholders = lateFeeIds.map(() => '?').join(',');
      const [paidRows] = await pool.query(
        `SELECT late_fee_id, SUM(amount) AS paid FROM late_fee_payments WHERE late_fee_id IN (${placeholders}) GROUP BY late_fee_id`,
        lateFeeIds,
      );
      paidById = new Map(paidRows.map((p) => [p.late_fee_id, Number(p.paid)]));
    }
    res.json({
      lateFees: rows.map((r) => {
        const amount = Number(r.amount);
        const paid = paidById.get(r.id) ?? 0;
        const remaining = amount - paid;
        return {
          id: r.id,
          amount,
          appliedAt: r.applied_at instanceof Date ? r.applied_at.toISOString().slice(0, 10) : String(r.applied_at).slice(0, 10),
          reason: r.reason,
          appliedBy: toActor(r.first_name, r.last_name, r.role),
          createdAt: r.created_at,
          paid,
          remaining,
          status: remaining <= 0 ? 'payee' : paid > 0 ? 'partielle' : 'impayee',
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/** Solde restant d'UNE pénalité (un bail peut en avoir plusieurs, réglées indépendamment). */
async function getLateFeeRemaining(conn, tenantId, lateFee) {
  const [rows] = await conn.query(
    'SELECT COALESCE(SUM(amount), 0) AS paid FROM late_fee_payments WHERE late_fee_id = :lateFeeId AND tenant_id = :tenantId',
    { lateFeeId: lateFee.id, tenantId },
  );
  return Number(lateFee.amount) - Number(rows[0].paid);
}

// POST /api/leases/:leaseId/late-fees/:lateFeeId/payments — régler (totalement ou partiellement) une
// pénalité déjà appliquée (étape 44bis, demande directe de l'utilisateur : « revenons sur les
// pénalités » — jusqu'ici aucun suivi de règlement n'existait, une créance appliquée restait affichée
// indéfiniment sans qu'on puisse jamais dire si elle avait été payée). Si le module comptabilité avancée
// est actif, génère `penalite_retard_encaissee` (solde la créance 411 déjà comptabilisée à
// l'application, ne recrée JAMAIS le produit 707).
router.post('/:leaseId/late-fees/:lateFeeId/payments', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const lateFeeId = Number(req.params.lateFeeId);
  if (!Number.isInteger(leaseId) || !Number.isInteger(lateFeeId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createLateFeePaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(conn, req.user.tenantId, leaseId, scopeAgentId);
    await assertPeriodOpen(req.user.tenantId, data.paidAt);

    const [lateFeeRows] = await conn.query(
      'SELECT * FROM late_fees WHERE id = :lateFeeId AND lease_id = :leaseId AND tenant_id = :tenantId LIMIT 1',
      { lateFeeId, leaseId, tenantId: req.user.tenantId },
    );
    if (!lateFeeRows[0]) throw new ApiError(404, 'Pénalité introuvable');

    const [renterRows] = await conn.query('SELECT first_name, last_name FROM renters WHERE id = :id', {
      id: lease.renter_id,
    });
    const renterName = renterRows[0] ? `${renterRows[0].first_name} ${renterRows[0].last_name}` : 'Locataire';

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, req.user.tenantId, data.paidAt);

    // Verrouille la pénalité : deux règlements simultanés ne doivent jamais pouvoir dépasser ensemble
    // le solde restant (même principe que le règlement de la dette initiale ci-dessus).
    await conn.query('SELECT id FROM late_fees WHERE id = :lateFeeId FOR UPDATE', { lateFeeId });
    if (data.idempotencyKey) await claimIdempotencyKey(conn, req.user.tenantId, 'late_fee_payment', data.idempotencyKey);

    const remaining = await getLateFeeRemaining(conn, req.user.tenantId, lateFeeRows[0]);
    if (remaining <= 0) {
      throw new ApiError(409, 'Cette pénalité est déjà intégralement réglée');
    }
    if (data.amount > remaining) {
      throw new ApiError(400, `Le montant dépasse le solde restant (${remaining} FCFA)`);
    }

    const [result] = await conn.query(
      `INSERT INTO late_fee_payments (tenant_id, late_fee_id, amount, payment_method, paid_at, notes, recorded_by)
       VALUES (:tenantId, :lateFeeId, :amount, :method, :paidAt, :notes, :recordedBy)`,
      {
        tenantId: req.user.tenantId,
        lateFeeId,
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
        operationType: 'penalite_retard_encaissee',
        entryDate: data.paidAt,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        narrationVars: { locataire: renterName },
        sourceTable: 'late_fee_payments',
        sourceId: paymentId,
        createdBy: req.user.id,
        context: { leaseId },
      });
    }

    await conn.commit();
    logger.info('Pénalité de retard réglée', { tenantId: req.user.tenantId, leaseId, lateFeeId, paymentId, amount: data.amount, by: req.user.id });
    res.status(201).json({ paymentId, remaining: remaining - data.amount });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
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
    // Clé d'idempotence (étape 36) : un envoi en double n'enregistre rien de plus.
    if (data.idempotencyKey) await claimIdempotencyKey(conn, req.user.tenantId, 'late_fee', data.idempotencyKey);

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
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, req.user.tenantId, data.paidAt);

    // Verrouille le bail : deux règlements simultanés ne doivent jamais
    // pouvoir dépasser ensemble le solde restant (même principe que le
    // verrou sur le paiement de loyer ci-dessus).
    await conn.query('SELECT id FROM leases WHERE id = :leaseId FOR UPDATE', { leaseId });
    // Clé d'idempotence (étape 36) : un envoi en double n'enregistre rien de plus.
    if (data.idempotencyKey) await claimIdempotencyKey(conn, req.user.tenantId, 'opening_debt_payment', data.idempotencyKey);

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
      'SELECT * FROM rent_payments WHERE id = :paymentId AND lease_id = :leaseId AND deleted_at IS NULL LIMIT 1',
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

// GET /api/leases/:leaseId/entry-receipt.pdf — reçu d'entrée (caution, frais
// d'agence, cautions supplémentaires, prorata), créé une fois pour toutes à
// la signature du bail (voir routes/renters.js) — 404 si rien n'a été payé à
// la signature (aucun reçu n'a alors été créé).
router.get('/:leaseId/entry-receipt.pdf', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);

    const [entryReceiptRows] = await pool.query('SELECT * FROM lease_entry_receipts WHERE lease_id = :leaseId LIMIT 1', {
      leaseId,
    });
    if (!entryReceiptRows[0]) {
      throw new ApiError(404, "Aucun reçu d'entrée pour ce bail : rien n'a été payé à la signature.");
    }

    const [renterRows] = await pool.query('SELECT * FROM renters WHERE id = :id LIMIT 1', { id: lease.renter_id });
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: req.user.tenantId });
    const [issuerRows] = await pool.query('SELECT * FROM users WHERE id = :id LIMIT 1', {
      id: entryReceiptRows[0].created_by,
    });
    const issuance = await getOrCreateIssuance(req.user.tenantId, 'recu_entree', entryReceiptRows[0].id);

    streamEntryReceiptPdf(res, {
      tenant: tenantRows[0],
      renter: renterRows[0],
      property: lease,
      lease,
      entryReceipt: entryReceiptRows[0],
      issuer: issuerRows[0] || null,
      verificationCode: issuance.verification_code,
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
      'SELECT id FROM rent_payments WHERE id = :paymentId AND lease_id = :leaseId AND deleted_at IS NULL LIMIT 1',
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
    await pool.query(
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
      // Jusqu'à 3 photos par élément (étape 48) — on ajoute, on ne remplace
      // plus jamais silencieusement une photo existante.
      if (found.item.photoUrls.length >= 3) {
        throw new ApiError(400, 'Maximum 3 photos par élément — supprimez-en une avant d’en ajouter une nouvelle.');
      }

      const rel = await saveInspectionFile(req.user.tenantId, leaseId, req.file, 'photo', 'Photo');
      found.item.photoUrls.push(toProtectedFileUrl(rel));

      await pool.query('UPDATE move_in_reports SET items = :items WHERE lease_id = :leaseId', {
        items: JSON.stringify({ zones }),
        leaseId,
      });

      const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
      res.json({ report: toPublicInspectionReport(row) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:leaseId/move-in-report/items/:zoneKey/:itemKey/photo/:photoIndex', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const photoIndex = Number(req.params.photoIndex);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));
  if (!Number.isInteger(photoIndex) || photoIndex < 0) return next(new ApiError(400, 'Index de photo invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const report = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    assertDraft(report, 'état des lieux d’entrée');

    const zones = normalizeStoredItems(report.items);
    const found = findItem(zones, req.params.zoneKey, req.params.itemKey);
    if (!found) throw new ApiError(404, 'Élément introuvable sur cette fiche');
    if (photoIndex >= found.item.photoUrls.length) throw new ApiError(404, 'Photo introuvable');

    const [oldPath] = found.item.photoUrls.splice(photoIndex, 1);
    await pool.query('UPDATE move_in_reports SET items = :items WHERE lease_id = :leaseId', {
      items: JSON.stringify({ zones }),
      leaseId,
    });
    if (oldPath) await deleteInspectionFile(stripFileUrlPrefix(oldPath));

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

    // Signatures numériques facultatives : l'état des lieux se signe à la main après impression.
    const tenantSignatureFile = req.files?.tenantSignature?.[0];
    const agentSignatureFile = req.files?.agentSignature?.[0];

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

      const tenantSignaturePath = tenantSignatureFile ? await saveInspectionFile(req.user.tenantId, leaseId, tenantSignatureFile, 'signature-locataire', 'Signature') : null;
      const agentSignaturePath = agentSignatureFile ? await saveInspectionFile(req.user.tenantId, leaseId, agentSignatureFile, 'signature-agent', 'Signature') : null;
      // Réserves du locataire (étape 48) — notées par l'agent à l'oral au
      // moment de la signature, si le locataire n'est pas d'accord sur un
      // point précis ; jamais un accès en écriture du locataire lui-même.
      const tenantReserves =
        typeof req.body?.tenantReserves === 'string' && req.body.tenantReserves.trim()
          ? req.body.tenantReserves.trim().slice(0, 2000)
          : null;

      // Correction (étape « crédibilité », 2026-10-17) : si cette fiche vient
      // d'être rouverte, le diff contenu avant/après réouverture est calculé
      // ici, au moment où le contenu redevient définitif — jamais pendant le
      // brouillon, qui peut encore changer plusieurs fois.
      const correctionChanges = report.reopened_at && report.pre_reopen_snapshot
        ? diffInspectionReport(report.pre_reopen_snapshot, snapshotForCorrection(zones, report.general_notes, tenantReserves))
        : null;

      await pool.query(
        `UPDATE move_in_reports
         SET status = 'finalized', finalized_at = NOW(), finalized_by = :by,
             tenant_signature_path = :tenantSig, agent_signature_path = :agentSig,
             tenant_reserves = :tenantReserves,
             correction_changes = :correctionChanges, pre_reopen_snapshot = NULL
         WHERE lease_id = :leaseId`,
        {
          by: req.user.id,
          tenantSig: tenantSignaturePath,
          agentSig: agentSignaturePath,
          tenantReserves,
          leaseId,
          correctionChanges: correctionChanges ? JSON.stringify(correctionChanges) : null,
        },
      );

      logger.info('État des lieux d’entrée finalisé', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
      const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
      res.json({ report: toPublicInspectionReport(row) });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/leases/:leaseId/move-in-report/reopen — DG uniquement, motif
// obligatoire : rouvre une fiche finalisée pour corriger une erreur de
// saisie. Invalide les deux signatures existantes (il faudra resigner avant
// de refinaliser) — une signature engage sur un contenu précis, jamais sur
// un contenu qui pourrait changer sans qu'elle le sache.
router.post('/:leaseId/move-in-report/reopen', canReopenInspection, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = reopenInspectionReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    await loadLease(pool, req.user.tenantId, leaseId, null);
    const report = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    assertFinalized(report, 'état des lieux d’entrée');

    const snapshot = snapshotForCorrection(normalizeStoredItems(report.items), report.general_notes, report.tenant_reserves);
    await pool.query(
      `UPDATE move_in_reports
       SET status = 'draft', finalized_at = NULL, finalized_by = NULL,
           tenant_signature_path = NULL, agent_signature_path = NULL,
           reopened_at = NOW(), reopened_by = :by, reopen_reason = :reason,
           pre_reopen_snapshot = :snapshot, correction_changes = NULL
       WHERE lease_id = :leaseId`,
      { by: req.user.id, reason: parsed.data.reason, leaseId, snapshot: JSON.stringify(snapshot) },
    );
    await deleteInspectionFile(report.tenant_signature_path);
    await deleteInspectionFile(report.agent_signature_path);

    logger.info('État des lieux d’entrée rouvert pour correction', {
      tenantId: req.user.tenantId,
      leaseId,
      by: req.user.id,
      reason: parsed.data.reason,
    });
    const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    res.json({ report: toPublicInspectionReport(row) });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/move-in-report.pdf — export PDF de l'état des
// lieux d'entrée finalisé (n'existait pas avant l'étape 48 — seule la sortie
// s'exportait, alors que le locataire signe les deux).
router.get('/:leaseId/move-in-report.pdf', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    if (!row) throw new ApiError(404, "Aucun état des lieux d'entrée pour ce bail");
    if (row.status !== 'finalized') {
      throw new ApiError(400, 'Cette fiche doit être finalisée (signée) avant de générer le PDF.');
    }

    const [renterRows] = await pool.query('SELECT * FROM renters WHERE id = :id LIMIT 1', { id: lease.renter_id });
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: req.user.tenantId });
    // Code de vérification (étape 29) — récupéré, jamais un téléchargement
    // compté ici : côté personnel, les téléchargements restent illimités par
    // conception (seul le portail public plafonne).
    const issuance = await getOrCreateIssuance(req.user.tenantId, 'etat_lieux_entree', leaseId);

    streamMoveInPdf(res, {
      tenant: tenantRows[0],
      renter: renterRows[0],
      property: lease,
      lease,
      report: toPublicInspectionReport(row),
      verificationCode: issuance.verification_code,
    });
  } catch (err) {
    next(err);
  }
});

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
      const isCalendaireForArrears = lease.rent_due_day != null;
      const [payments] = await pool.query(
        'SELECT covers_month, covers_period_start, amount FROM rent_payments WHERE lease_id = :leaseId AND deleted_at IS NULL',
        { leaseId },
      );
      arrears = computeArrears({
        startDate: lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date,
        createdAt: lease.created_at,
        upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
        rentDueDay: lease.rent_due_day,
        rentDueOffsetDays: lease.rent_due_offset_days,
        rentTiming: lease.rent_timing,
        monthlyRent: lease.monthly_rent,
        entryProration: lease.entry_proration,
        payments: payments.map((p) => ({
          coversMonth: isCalendaireForArrears
            ? p.covers_month
            : p.covers_period_start instanceof Date
              ? p.covers_period_start.toISOString().slice(0, 10)
              : String(p.covers_period_start).slice(0, 10),
          amount: Number(p.amount),
        })),
        rhythm: { mode: isCalendaireForArrears ? 'calendaire' : 'jour_fixe' },
      });
    }

    const additionalDeposits = await listLeaseDeposits(req.user.tenantId, leaseId);
    const statement = row && row.status === 'draft'
      ? await computeMoveOutStatement(pool, { tenantId: req.user.tenantId, lease, report: row, deposits: additionalDeposits })
      : null;
    res.json({ report: toPublicMoveOutReport(row), arrears, additionalDeposits, statement });
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

    await pool.query(
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

    // Étape 51bis (Moyenne #7) : une retenue peinture saisie sur un bail SANS caution peinture n'avait
    // jusqu'ici aucun effet réel — `checkAdditionalDepositRefunds`/`finalizeAdditionalDeposits` ignorent
    // silencieusement tout type sans caution `held` correspondante (voir leaseDeposits.js), donc ce
    // montant n'entrait jamais dans `totalDeductions`/`netRefund` ni dans aucune écriture GL, alors que le
    // PV l'affichait comme une retenue bien réelle. Bloqué dès la saisie plutôt que de laisser un montant
    // fantôme s'afficher sur un document officiel.
    if (data.peintureDeductionAmount > 0) {
      const deposits = await listLeaseDeposits(req.user.tenantId, leaseId, pool);
      const heldPeinture = deposits.find((d) => d.type === 'peinture' && d.status === 'held');
      if (!heldPeinture) {
        throw new ApiError(400, "Aucune caution peinture n'est détenue sur ce bail — impossible d'y imputer une retenue.");
      }
    }

    // Un élément avec des lignes de facturation (catalogue) voit son montant
    // de retenue RECALCULÉ à partir de ces lignes, jamais celui envoyé tel
    // quel par le client (voir `computeItemDeduction`).
    recomputeItemDeductions(data.zones);
    const itemsDeductions = sumDeductions(data.zones);
    // Lignes libres (main-d'œuvre, pénalités…) : leur total alimente `other_deductions_amount`, déjà lu par
    // tout le reste (finalisation, PDF, comptabilité) — une réparation faite par le locataire ne coûte rien.
    const extraLines = data.extraLines;
    const otherAmount = extraLines
      ? extraLines.reduce((sum, l) => sum + (l.kind === 'realisee_locataire' ? 0 : l.amount), 0)
      : data.otherDeductionsAmount;
    const otherNote = extraLines
      ? (extraLines.filter((l) => l.kind !== 'realisee_locataire').map((l) => l.label).join(' ; ').slice(0, 255) || null)
      : data.otherDeductionsNote;
    const totalDeductions = itemsDeductions + otherAmount;
    const netRefund = Math.max(0, Number(report.deposit_amount) - totalDeductions);

    await pool.query(
      `UPDATE move_out_reports
       SET items = :items, general_notes = :notes,
           other_deductions_amount = :otherAmount, other_deductions_note = :otherNote,
           extra_lines = COALESCE(:extraLines, extra_lines),
           peinture_deduction_amount = :peintureAmount, peinture_deduction_note = :peintureNote,
           total_deductions = :totalDeductions, net_refund = :netRefund
           ${data.conductedAt ? ', conducted_at = :conductedAt' : ''}
       WHERE lease_id = :leaseId`,
      {
        items: JSON.stringify({ zones: data.zones }),
        notes: data.generalNotes,
        otherAmount,
        otherNote,
        extraLines: extraLines ? JSON.stringify(extraLines) : null,
        peintureAmount: data.peintureDeductionAmount,
        peintureNote: data.peintureDeductionNote,
        totalDeductions,
        netRefund,
        conductedAt: data.conductedAt,
        leaseId,
      },
    );

    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    const additionalDeposits = await listLeaseDeposits(req.user.tenantId, leaseId);
    const lease = await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const statement = await computeMoveOutStatement(pool, { tenantId: req.user.tenantId, lease, report: row, deposits: additionalDeposits });
    res.json({ report: toPublicMoveOutReport(row), additionalDeposits, statement });
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
      if (found.item.photoUrls.length >= 3) {
        throw new ApiError(400, 'Maximum 3 photos par élément — supprimez-en une avant d’en ajouter une nouvelle.');
      }

      const rel = await saveInspectionFile(req.user.tenantId, leaseId, req.file, 'photo', 'Photo');
      found.item.photoUrls.push(toProtectedFileUrl(rel));

      await pool.query('UPDATE move_out_reports SET items = :items WHERE lease_id = :leaseId', {
        items: JSON.stringify({ zones }),
        leaseId,
      });

      const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
      res.json({ report: toPublicMoveOutReport(row) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:leaseId/move-out-report/items/:zoneKey/:itemKey/photo/:photoIndex', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const photoIndex = Number(req.params.photoIndex);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));
  if (!Number.isInteger(photoIndex) || photoIndex < 0) return next(new ApiError(400, 'Index de photo invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    assertDraft(report, 'état des lieux de sortie');

    const zones = normalizeStoredItems(report.items);
    const found = findItem(zones, req.params.zoneKey, req.params.itemKey);
    if (!found) throw new ApiError(404, 'Élément introuvable sur cette fiche');
    if (photoIndex >= found.item.photoUrls.length) throw new ApiError(404, 'Photo introuvable');

    const [oldPath] = found.item.photoUrls.splice(photoIndex, 1);
    await pool.query('UPDATE move_out_reports SET items = :items WHERE lease_id = :leaseId', {
      items: JSON.stringify({ zones }),
      leaseId,
    });
    if (oldPath) await deleteInspectionFile(stripFileUrlPrefix(oldPath));

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

    const conn = await pool.getConnection();
    try {
      const scopeAgentId = await resolvePropertyScope(req.user);
      const lease = await loadLease(conn, req.user.tenantId, leaseId, scopeAgentId);
      const report = await loadInspectionReportRow(conn, 'move_out_reports', leaseId);
      assertDraft(report, 'état des lieux de sortie');
      // Une fiche déjà rouverte une fois (étape 48, correction DG) a déjà
      // terminé le bail et libéré l'unité lors de sa PREMIÈRE finalisation —
      // on ne rejoue jamais ces effets de bord une seconde fois, seul le
      // contenu de la fiche (grille, retenues, signatures) est corrigé.
      const isCorrection = !!report.reopened_at;
      if (!isCorrection && lease.status !== 'active') throw new ApiError(400, 'Ce bail est déjà terminé');

      const zones = normalizeStoredItems(report.items);
      const missing = getMissingConditionLabels(zones);
      if (missing.length > 0) {
        throw new ApiError(400, `État manquant pour : ${missing.join(', ')}`);
      }

      const REFUND_METHODS = ['especes', 'mobile_money', 'virement', 'cheque'];
      const readRefundMethod = (field) => (REFUND_METHODS.includes(req.body?.[field]) ? req.body[field] : undefined);

      // Cautions supplémentaires (étape 43) — vérifié TÔT (avant l'écriture des fichiers de signature
      // sur disque ci-dessous), même principe que le mode de règlement de la caution de loyer plus bas :
      // un mode manquant ne doit jamais laisser des fichiers orphelins ou un état à moitié traité.
      // `peintureOverflow` (dépassement de la retenue peinture au-delà de SA PROPRE caution) s'ajoute
      // aux retenues de la caution de LOYER (décision explicite de l'utilisateur, étape 43).
      const additionalDepositRefundMethods = {
        sbee: readRefundMethod('refundMethodSbee'),
        soneb: readRefundMethod('refundMethodSoneb'),
        peinture: readRefundMethod('refundMethodPeinture'),
      };
      // Étape 51bis (Moyenne #6) : `checkAdditionalDepositRefunds` ne regarde que les cautions encore
      // `held` — sur une CORRECTION (`isCorrection`), elles sont déjà `returned` depuis la PREMIÈRE
      // finalisation (`finalizeAdditionalDeposits` n'est jamais rejouée sur correction, juste en dessous),
      // donc un recalcul retomberait TOUJOURS à 0, perdant silencieusement un dépassement pourtant
      // légitimement facturé la première fois. Sur correction, on relit la valeur PERSISTÉE
      // (`move_out_reports.peinture_overflow_amount`, migration 079) au lieu de la recalculer.
      const peintureOverflow = isCorrection
        ? Number(report.peinture_overflow_amount)
        : (
            await checkAdditionalDepositRefunds(conn, {
              tenantId: req.user.tenantId,
              leaseId,
              peintureDeductionAmount: Number(report.peinture_deduction_amount),
              refundMethods: additionalDepositRefundMethods,
            })
          ).peintureOverflow;

      const itemsDeductions = sumDeductions(zones);

      // Arriérés de loyer réglés par la caution à la sortie (demande utilisateur, 2026-10-18) :
      // jusqu'ici, un locataire quittant en devant encore du loyer voyait cette dette simplement
      // disparaître (`leases.status = 'ended'` exclut immédiatement le bail de
      // `listPortfolioArrears`) sans jamais être réglée — la caution ne protégeait que contre les
      // dégradations. Même calcul EXACT que ce qui s'affiche comme « impayé » sur le tableau de
      // bord/les relances (`computeRentOwed`, extrait de `listPortfolioArrears`), daté au jour de
      // la sortie (`report.conducted_at`), jamais rejoué sur une correction (`isCorrection` — déjà
      // réglé à la première finalisation). Priorité aux dégradations déjà calculées ci-dessus :
      // les arriérés ne consomment que ce qu'il reste de la caution après elles, plafonnés comme
      // tout le reste à son montant — jamais de découvert tracé au-delà.
      let rentArrearsAmount;
      let rentOwedGross = Number(report.rent_owed_amount) || 0;
      let rentArrearsAllocationBasis = null; // { arrears, rhythm, isCalendaire } — réutilisé plus bas pour générer les lignes rent_payments.
      if (isCorrection) {
        rentArrearsAmount = Number(report.rent_arrears_amount);
      } else {
        const isCalendaireForArrears = lease.rent_due_day != null;
        const [existingPayments] = await conn.query(
          'SELECT covers_month, covers_period_start, amount FROM rent_payments WHERE lease_id = :leaseId AND deleted_at IS NULL',
          { leaseId },
        );
        const rhythmForArrears = { mode: isCalendaireForArrears ? 'calendaire' : 'jour_fixe' };
        const { arrears, rentOwed } = computeRentOwed({
          lease,
          payments: existingPayments.map((p) => ({
            coversMonth: isCalendaireForArrears
              ? p.covers_month
              : p.covers_period_start instanceof Date
                ? p.covers_period_start.toISOString().slice(0, 10)
                : String(p.covers_period_start).slice(0, 10),
            amount: Number(p.amount),
          })),
          rhythm: rhythmForArrears,
          asOfDate: report.conducted_at instanceof Date ? report.conducted_at.toISOString().slice(0, 10) : report.conducted_at,
        });
        const remainingDepositAfterDamages = Math.max(
          0,
          Number(report.deposit_amount) - itemsDeductions - Number(report.other_deductions_amount) - peintureOverflow,
        );
        rentOwedGross = rentOwed;
        rentArrearsAmount = Math.min(rentOwed, remainingDepositAfterDamages);
        rentArrearsAllocationBasis = { arrears, rhythm: rhythmForArrears, isCalendaire: isCalendaireForArrears };
      }

      const totalDeductions = itemsDeductions + Number(report.other_deductions_amount) + peintureOverflow + rentArrearsAmount;
      const depositAmount = Number(report.deposit_amount);
      const netRefund = Math.max(0, depositAmount - totalDeductions);

      // Solde négatif : ce que le locataire doit encore quand ses dettes (dégradations, loyers, pénalités…)
      // dépassent la caution. Il doit alors soit régler la différence, soit effectuer lui-même les
      // réparations — choix exigé AVANT de finaliser. Sur correction, valeur déjà figée à la 1re finalisation.
      const shortfall = isCorrection
        ? Number(report.balance_due_amount)
        : Math.max(0, itemsDeductions + Number(report.other_deductions_amount) + peintureOverflow + rentOwedGross - depositAmount);
      let balanceResolution = null;
      let balancePaymentMethod = null;
      const balanceNote = typeof req.body?.balanceNote === 'string' && req.body.balanceNote.trim() ? req.body.balanceNote.trim().slice(0, 255) : null;
      if (shortfall > 0) {
        if (isCorrection) {
          balanceResolution = report.balance_resolution;
          balancePaymentMethod = report.balance_payment_method;
        } else {
          balanceResolution = ['paid', 'repairs_by_tenant'].includes(req.body?.balanceResolution) ? req.body.balanceResolution : null;
          if (!balanceResolution) {
            throw new ApiError(400, `Le locataire doit encore ${shortfall} FCFA : indiquez s'il règle la différence ou s'il effectue les réparations.`);
          }
          if (balanceResolution === 'paid') {
            balancePaymentMethod = REFUND_METHODS.includes(req.body?.balancePaymentMethod) ? req.body.balancePaymentMethod : null;
            if (!balancePaymentMethod) throw new ApiError(400, 'Indiquez comment le locataire règle la différence.');
          }
        }
      }

      // Module comptabilité SYSCOHADA (nouveau) : mode de règlement requis
      // seulement s'il reste réellement quelque chose à reverser (une
      // caution intégralement absorbée par des retenues n'implique aucun
      // mouvement de trésorerie). Voir routes/renters.js `recordDepositReceived`
      // pour la réception — même principe, symétrique.
      const refundPaymentMethod = typeof req.body?.refundPaymentMethod === 'string' ? req.body.refundPaymentMethod : '';
      if (netRefund > 0 && !REFUND_METHODS.includes(refundPaymentMethod)) {
        throw new ApiError(400, 'Mode de règlement requis pour la restitution de la caution');
      }

      const tenantSignaturePath = tenantSignatureFile ? await saveInspectionFile(req.user.tenantId, leaseId, tenantSignatureFile, 'signature-locataire', 'Signature') : null;
      const agentSignaturePath = agentSignatureFile ? await saveInspectionFile(req.user.tenantId, leaseId, agentSignatureFile, 'signature-agent', 'Signature') : null;
      const tenantReserves =
        typeof req.body?.tenantReserves === 'string' && req.body.tenantReserves.trim()
          ? req.body.tenantReserves.trim().slice(0, 2000)
          : null;

      const [renterRows] = await conn.query(
        'SELECT r.first_name, r.last_name FROM leases l JOIN renters r ON r.id = l.renter_id WHERE l.id = :leaseId LIMIT 1',
        { leaseId },
      );
      const renterName = renterRows[0] ? `${renterRows[0].first_name} ${renterRows[0].last_name}` : 'Locataire';

      // Bug corrigé (audit fermeture du mois, point 2, 16/10/2026) : finaliser une sortie règle
      // réellement de l'argent (restitution de caution, règlement SBEE/SONEB par la caution) daté
      // `report.conducted_at` — jamais vérifié contre la clôture du mois jusqu'ici. `toPeriod`
      // (services/accountingPeriods.js) accepte directement un objet Date tel que renvoyé par mysql2.
      await assertPeriodOpen(req.user.tenantId, report.conducted_at);

      await conn.beginTransaction();
      await assertPeriodOpenLocked(conn, req.user.tenantId, report.conducted_at);

      // Correction (étape « crédibilité », 2026-10-17) : même principe que
      // pour l'entrée — le diff n'a de sens qu'en cas de réouverture réelle.
      const correctionChanges = isCorrection && report.pre_reopen_snapshot
        ? diffInspectionReport(report.pre_reopen_snapshot, snapshotForCorrection(zones, report.general_notes, tenantReserves))
        : null;

      await conn.query(
        `UPDATE move_out_reports
         SET status = 'finalized', finalized_at = NOW(), finalized_by = :by,
             tenant_signature_path = :tenantSig, agent_signature_path = :agentSig,
             tenant_reserves = :tenantReserves,
             total_deductions = :totalDeductions, net_refund = :netRefund, refund_payment_method = :refundMethod,
             peinture_overflow_amount = :peintureOverflow, rent_arrears_amount = :rentArrearsAmount,
             rent_owed_amount = :rentOwedGross, balance_due_amount = :shortfall, balance_resolution = :balanceResolution,
             balance_payment_method = :balancePaymentMethod, balance_note = :balanceNote,
             gl_regularized_at = NULL, gl_regularized_by = NULL,
             correction_changes = :correctionChanges, pre_reopen_snapshot = NULL
         WHERE lease_id = :leaseId`,
        {
          by: req.user.id,
          tenantSig: tenantSignaturePath,
          agentSig: agentSignaturePath,
          tenantReserves,
          totalDeductions,
          netRefund,
          refundMethod: netRefund > 0 ? refundPaymentMethod : null,
          peintureOverflow,
          rentArrearsAmount,
          rentOwedGross,
          shortfall,
          balanceResolution,
          balancePaymentMethod,
          balanceNote,
          leaseId,
          correctionChanges: correctionChanges ? JSON.stringify(correctionChanges) : null,
        },
      );

      let finalizedAdditionalDeposits;
      if (!isCorrection) {
        await conn.query(
          "UPDATE leases SET status = 'ended', end_date = :endDate, deposit_status = 'returned' WHERE id = :id",
          { endDate: report.conducted_at, id: leaseId },
        );
        await conn.query("UPDATE property_units SET status = 'libre' WHERE id = :id", { id: lease.unit_id });

        // Cautions supplémentaires (étape 43) — décompte de sortie (SBEE/SONEB règlent le solde impayé
        // réel, peinture applique la retenue saisie) DANS la même transaction que la sortie elle-même.
        // Jamais rejoué sur une correction (`isCorrection`) : déjà réglé à la première finalisation.
        await finalizeAdditionalDeposits(conn, {
          tenantId: req.user.tenantId,
          leaseId,
          moveOutDate: report.conducted_at,
          peintureDeductionAmount: Number(report.peinture_deduction_amount),
          peintureDeductionNote: report.peinture_deduction_note,
          refundMethods: additionalDepositRefundMethods,
          renterName,
          createdBy: req.user.id,
        });

        // Arriérés de loyer réglés par la caution (voir calcul ci-dessus) : enregistrés comme des
        // paiements RÉELS (`rent_payments`, mode 'caution') — jamais seulement une ligne de
        // retenue sur le PV — pour que toute vue qui lit l'historique des paiements (point mensuel
        // de clôture, fiche du locataire) voie ces mois comme soldés, exactement comme le demande
        // l'utilisateur (« il ne doit plus être dans les mois suivants »). Aucune quittance ni
        // écriture GL automatique ici : même traitement « à régulariser manuellement » que le
        // reste d'une caution retenue (voir `depositAccountingNote` ci-dessous) — pas plus
        // automatisé que les dégradations, qui ne le sont pas non plus aujourd'hui.
        if (rentArrearsAmount > 0 && rentArrearsAllocationBasis) {
          const { arrears, rhythm: arrearsRhythm, isCalendaire: arrearsIsCalendaire } = rentArrearsAllocationBasis;
          const { allocations } = allocateRentPayment({
            rhythm: arrearsRhythm,
            nextDueMonth: arrears.nextDueMonth,
            monthlyRent: lease.monthly_rent,
            alreadyPaidForNextDueMonth: arrears.paidForNextDueMonth,
            amount: rentArrearsAmount,
          });
          for (const alloc of allocations) {
            const coversPeriodStart = arrearsIsCalendaire ? `${alloc.coversMonth}-01` : alloc.coversMonth;
            await conn.query(
              `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, notes, recorded_by)
               VALUES (:tenantId, :leaseId, :coversMonth, :coversPeriodStart, :amount, 'caution', :paidAt, :notes, :recordedBy)`,
              {
                tenantId: req.user.tenantId,
                leaseId,
                coversMonth: arrearsIsCalendaire ? alloc.coversMonth : null,
                coversPeriodStart,
                amount: alloc.amount,
                paidAt: report.conducted_at,
                notes: 'Réglé par la caution à la sortie',
                recordedBy: req.user.id,
              },
            );
          }
        }
      }
      finalizedAdditionalDeposits = await listLeaseDeposits(req.user.tenantId, leaseId, conn);

      // Module comptabilité SYSCOHADA (nouveau) — restitution SIMPLE
      // uniquement (aucune retenue) : le sort comptable d'une retenue sur
      // caution (produit du cabinet ? compensation pour le propriétaire ?)
      // est un choix de jugement comptable non tranché (voir seed, règle
      // `caution_restituee`) — jamais inventé ici. Avec retenue, la caution
      // reste "à régulariser manuellement" — désormais aussi signalée
      // durablement dans « Mes tâches » (routes/tasks.js) tant que personne
      // ne l'a marquée réglée, pas seulement dans cette réponse ponctuelle.
      let depositAccountingNote = null;
      if (await isModuleActive(conn, req.user.tenantId)) {
        if (totalDeductions === 0 && netRefund > 0) {
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
          depositAccountingNote = rentArrearsAmount > 0
            ? `Caution avec retenue (dont ${rentArrearsAmount} FCFA d'arriérés de loyer réglés via la caution) : à régulariser manuellement dans Comptabilité avancée → Journal → Écriture diverse (le sort comptable d'une retenue sur caution n'est pas encore automatisé). Ce rappel reste visible dans « Mes tâches » jusqu'à ce qu'il soit marqué réglé.`
            : 'Caution avec retenue : à régulariser manuellement dans Comptabilité avancée → Journal → Écriture diverse (le sort comptable d\'une retenue sur caution n\'est pas encore automatisé). Ce rappel reste visible dans « Mes tâches » jusqu\'à ce qu\'il soit marqué réglé.';
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
      res.json({ report: toPublicMoveOutReport(row), depositAccountingNote, additionalDeposits: finalizedAdditionalDeposits });
    } catch (err) {
      await conn.rollback().catch(() => {});
      next(err);
    } finally {
      conn.release();
    }
  },
);

// POST /api/leases/:leaseId/move-out-report/reopen — DG uniquement, motif
// obligatoire. Contrairement à l'entrée, la sortie a des effets de bord
// déjà survenus (bail terminé, unité libérée, cautions supplémentaires
// réglées) : la réouverture NE LES DÉFAIT PAS (ce sont des faits, pas des
// erreurs de saisie) — seul le CONTENU de la fiche (grille, retenues,
// signatures) redevient modifiable. Si une écriture "caution restituée"
// avait été postée automatiquement, elle est extournée (jamais modifiée ni
// supprimée directement) : la refinalisation en postera une nouvelle si le
// nouveau calcul le justifie encore.
router.post('/:leaseId/move-out-report/reopen', canReopenInspection, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = reopenInspectionReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  const conn = await pool.getConnection();
  try {
    await loadLease(conn, req.user.tenantId, leaseId, null);
    const report = await loadInspectionReportRow(conn, 'move_out_reports', leaseId);
    assertFinalized(report, 'état des lieux de sortie');

    // Bug corrigé (audit fermeture du mois, points 2 et 5, 16/10/2026) : SI une écriture "caution
    // restituée" existe (module actif), l'extourne ci-dessous la reverse, datée AUJOURD'HUI (date de
    // l'écriture MIROIR elle-même, jamais celle de l'état des lieux original) — jamais vérifiée contre
    // la clôture du mois jusqu'ici. Même principe que le correctif déjà en place sur l'extourne
    // MANUELLE (`routes/gl/glEntries.js POST /:id/extourne`), jamais propagé à celle-ci. Vérifié
    // SEULEMENT si une écriture existe réellement à reverser : une réouverture sans aucun impact
    // comptable (module inactif, ou aucune écriture postée) n'a pas à être bloquée par la clôture
    // d'aujourd'hui.
    const todayIso = new Date().toISOString().slice(0, 10);
    const moduleActiveBeforeTx = await isModuleActive(conn, req.user.tenantId);
    let entryToReverseId = null;
    if (moduleActiveBeforeTx) {
      const [[entry]] = await conn.query(
        `SELECT id FROM gl_entries
         WHERE tenant_id = :tenantId AND source_table = 'move_out_reports' AND source_id = :reportId AND status = 'validee'
         LIMIT 1`,
        { tenantId: req.user.tenantId, reportId: report.id },
      );
      entryToReverseId = entry?.id ?? null;
      if (entryToReverseId) await assertPeriodOpen(req.user.tenantId, todayIso);
    }

    await conn.beginTransaction();

    if (entryToReverseId) {
      await assertPeriodOpenLocked(conn, req.user.tenantId, todayIso);
      await extourneEcriture(conn, {
        tenantId: req.user.tenantId,
        entryId: entryToReverseId,
        entryDate: todayIso,
        userId: req.user.id,
        reason: `État des lieux de sortie rouvert pour correction : ${parsed.data.reason}`,
      });
    }

    const snapshot = snapshotForCorrection(normalizeStoredItems(report.items), report.general_notes, report.tenant_reserves);
    await conn.query(
      `UPDATE move_out_reports
       SET status = 'draft', finalized_at = NULL, finalized_by = NULL,
           tenant_signature_path = NULL, agent_signature_path = NULL,
           reopened_at = NOW(), reopened_by = :by, reopen_reason = :reason,
           pre_reopen_snapshot = :snapshot, correction_changes = NULL
       WHERE lease_id = :leaseId`,
      { by: req.user.id, reason: parsed.data.reason, leaseId, snapshot: JSON.stringify(snapshot) },
    );

    await conn.commit();
    await deleteInspectionFile(report.tenant_signature_path);
    await deleteInspectionFile(report.agent_signature_path);

    logger.info('État des lieux de sortie rouvert pour correction', {
      tenantId: req.user.tenantId,
      leaseId,
      by: req.user.id,
      reason: parsed.data.reason,
    });
    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    const additionalDeposits = await listLeaseDeposits(req.user.tenantId, leaseId);
    res.json({ report: toPublicMoveOutReport(row), additionalDeposits });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// POST /api/leases/:leaseId/move-out-report/gl-regularized — marque comme
// réglée (à la main, dans Comptabilité → Journal → Écriture diverse) une
// restitution de caution avec retenue, jamais comptabilisée automatiquement
// (voir la finalisation ci-dessus). Fait disparaître le rappel de « Mes
// tâches » (routes/tasks.js) — sans quoi il resterait affiché indéfiniment.
router.post('/:leaseId/move-out-report/gl-regularized', canRegularizeGl, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    assertFinalized(report, 'état des lieux de sortie');
    if (Number(report.total_deductions) <= 0) {
      throw new ApiError(400, 'Cette sortie ne nécessite aucune régularisation manuelle.');
    }

    await pool.query(
      `UPDATE move_out_reports SET gl_regularized_at = NOW(), gl_regularized_by = :by WHERE lease_id = :leaseId`,
      { by: req.user.id, leaseId },
    );

    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    res.json({ report: toPublicMoveOutReport(row) });
  } catch (err) {
    next(err);
  }
});

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
    const additionalDeposits = await listLeaseDeposits(req.user.tenantId, leaseId);
    const issuance = await getOrCreateIssuance(req.user.tenantId, 'etat_lieux_sortie', leaseId);

    streamMoveOutPdf(res, {
      tenant: tenantRows[0],
      renter: renterRows[0],
      property: lease,
      lease,
      report: toPublicMoveOutReport(row),
      moveInZones,
      additionalDeposits,
      verificationCode: issuance.verification_code,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/contract — contrat de bail (le cas échéant) + aperçu LIVE des données du
// bail (toujours à jour tant qu'il n'est pas finalisé — voir services/leaseContract.js).
router.get('/:leaseId/contract', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const row = await loadContractRow(req.user.tenantId, leaseId);
    const preview = await buildContractData(req.user.tenantId, leaseId, {
      particularConditions: row?.particular_conditions ?? null,
    });
    res.json({ contract: toPublicContract(row), preview });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/contract — démarre le BROUILLON du contrat (une fois par bail) ; les
// articles n'ont rien à saisir (calculés depuis le bail), seules les conditions particulières le sont.
router.post('/:leaseId/contract', canLocataires, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);

    const [existing] = await pool.query('SELECT id FROM lease_contracts WHERE lease_id = :leaseId LIMIT 1', {
      leaseId,
    });
    if (existing[0]) throw new ApiError(409, 'Un contrat existe déjà pour ce bail');

    await pool.query(
      `INSERT INTO lease_contracts (tenant_id, lease_id, status, created_by) VALUES (:tenantId, :leaseId, 'draft', :by)`,
      { tenantId: req.user.tenantId, leaseId, by: req.user.id },
    );

    logger.info('Contrat de bail démarré (brouillon)', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
    const row = await loadContractRow(req.user.tenantId, leaseId);
    const preview = await buildContractData(req.user.tenantId, leaseId, { particularConditions: null });
    res.status(201).json({ contract: toPublicContract(row), preview });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/leases/:leaseId/contract — enregistre les conditions particulières (seul champ
// personnalisable). Refusé une fois finalisé.
router.patch('/:leaseId/contract', canLocataires, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateContractSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const contract = await loadContractRow(req.user.tenantId, leaseId);
    assertDraft(contract, 'contrat de bail');

    await pool.query('UPDATE lease_contracts SET particular_conditions = :text WHERE lease_id = :leaseId', {
      text: parsed.data.particularConditions,
      leaseId,
    });

    const row = await loadContractRow(req.user.tenantId, leaseId);
    const preview = await buildContractData(req.user.tenantId, leaseId, {
      particularConditions: row.particular_conditions,
    });
    res.json({ contract: toPublicContract(row), preview });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/contract/finalize — verrouille le contrat (signatures des deux parties) ;
// fige les données du bail dans `snapshot` — un contrat déjà signé ne change plus jamais de contenu,
// même si le bail est modifié ensuite (voir migration 070).
router.post(
  '/:leaseId/contract/finalize',
  canLocataires,
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
      const contract = await loadContractRow(req.user.tenantId, leaseId);
      assertDraft(contract, 'contrat de bail');

      const snapshot = await buildContractData(req.user.tenantId, leaseId, {
        particularConditions: contract.particular_conditions,
      });

      const tenantSignaturePath = await saveInspectionFile(req.user.tenantId, leaseId, tenantSignatureFile, 'signature-locataire', 'Signature');
      const agentSignaturePath = await saveInspectionFile(req.user.tenantId, leaseId, agentSignatureFile, 'signature-agent', 'Signature');

      await pool.query(
        `UPDATE lease_contracts
         SET status = 'finalized', finalized_at = NOW(), finalized_by = :by,
             tenant_signature_path = :tenantSig, agent_signature_path = :agentSig, snapshot = :snapshot
         WHERE lease_id = :leaseId`,
        {
          by: req.user.id,
          tenantSig: tenantSignaturePath,
          agentSig: agentSignaturePath,
          snapshot: JSON.stringify(snapshot),
          leaseId,
        },
      );

      logger.info('Contrat de bail finalisé', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
      const row = await loadContractRow(req.user.tenantId, leaseId);
      res.json({ contract: toPublicContract(row), preview: snapshot });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/leases/:leaseId/contract.pdf — brouillon (aperçu LIVE, jamais signé) ou contrat finalisé
// (données figées à la signature) — jamais de limite de téléchargement côté employé (par conception).
router.get('/:leaseId/contract.pdf', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lease = await loadLease(pool, req.user.tenantId, leaseId, scopeAgentId);
    const contract = await loadContractRow(req.user.tenantId, leaseId);
    if (!contract) throw new ApiError(404, 'Aucun contrat pour ce bail');

    const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: req.user.tenantId });
    const [[dg]] = await pool.query(
      "SELECT first_name, last_name, role, stamp_path, signature_path FROM users WHERE tenant_id = :tenantId AND role = 'dg' LIMIT 1",
      { tenantId: req.user.tenantId },
    );

    // `snapshot` est une colonne JSON — le pilote mysql2 la relit déjà comme un objet JS natif, jamais
    // une chaîne à parser (contrairement à un champ TEXT contenant du JSON) : `JSON.parse` planterait ici
    // ("[object Object]" n'est pas un JSON valide).
    const data =
      contract.status === 'finalized'
        ? contract.snapshot
        : await buildContractData(req.user.tenantId, leaseId, { particularConditions: contract.particular_conditions });

    streamLeaseContractPdf(res, {
      tenant,
      data,
      contract: toPublicContract(contract),
      issuer: dg || { first_name: tenant?.company_name ?? "L'entreprise", last_name: '' },
      leaseId: lease.id,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/payment-links — génère un lien de paiement FedaPay
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

    const [[tenant]] = await pool.query('SELECT fedapay_collect_enabled FROM tenants WHERE id = :id LIMIT 1', {
      id: req.user.tenantId,
    });
    if (!tenant?.fedapay_collect_enabled) {
      throw new ApiError(400, 'Le paiement en ligne (FedaPay) n\'est pas activé pour votre entreprise (Réglages).');
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
