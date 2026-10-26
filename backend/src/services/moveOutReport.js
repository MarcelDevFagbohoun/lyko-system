'use strict';

/**
 * État des lieux de SORTIE — lecture, brouillon, photos, finalisation (cautions, arriérés, GL),
 * réouverture, régularisation comptable manuelle, données PDF. Les routes gardent la validation,
 * les logs, le périmètre agent et la mise en forme publique (`toPublicMoveOutReport`).
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { loadLease } = require('./rentPayments');
const { computeArrears, allocateRentPayment, computeRentOwed } = require('./rentTracking');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('./accountingPeriods');
const { getOrCreateIssuance } = require('./documentIssuance');
const { genererEcriture, isModuleActive } = require('./gl/glPostingService');
const { extourneEcriture } = require('./gl/glReversalService');
const {
  listLeaseDeposits,
  checkAdditionalDepositRefunds,
  finalizeAdditionalDeposits,
} = require('./leaseDeposits');
const { computeMoveOutStatement } = require('./moveOutStatement');
const {
  cloneMasterZones,
  cloneZonesFrom,
  normalizeStoredItems,
  findItem,
  getMissingConditionLabels,
  sumDeductions,
  recomputeItemDeductions,
  snapshotForCorrection,
  diffInspectionReport,
} = require('./inspection');
const { toProtectedFileUrl, stripFileUrlPrefix } = require('../utils/uploads');
const {
  loadInspectionReportRow,
  assertDraft,
  assertFinalized,
  saveInspectionFile,
  deleteInspectionFile,
} = require('./inspectionReports');

/** Fiche de sortie (ou null) + arriérés en cours + cautions supplémentaires + décompte (brouillon seulement). */
async function getMoveOutReport(tenantId, leaseId, scopeAgentId) {
  const lease = await loadLease(pool, tenantId, leaseId, scopeAgentId);
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

  const additionalDeposits = await listLeaseDeposits(tenantId, leaseId);
  const statement = row && row.status === 'draft'
    ? await computeMoveOutStatement(pool, { tenantId: tenantId, lease, report: row, deposits: additionalDeposits })
    : null;
  return { row, arrears, additionalDeposits, statement };
}

/** Démarre le BROUILLON, amorcé avec les zones de la fiche d'entrée (ou les zones standards). */
async function startMoveOutReport(tenantId, userId, leaseId, scopeAgentId, conductedAt) {
  const lease = await loadLease(pool, tenantId, leaseId, scopeAgentId);
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
      tenantId: tenantId,
      leaseId,
      conductedAt: conductedAt || new Date().toISOString().slice(0, 10),
      items: JSON.stringify({ zones }),
      depositAmount,
      by: userId,
    },
  );
  const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  return row;
}

/** Enregistre le brouillon (zones, retenues, notes) et renvoie fiche + cautions + décompte. */
async function updateMoveOutDraft(tenantId, leaseId, scopeAgentId, data) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  assertDraft(report, 'état des lieux de sortie');

  // Étape 51bis (Moyenne #7) : une retenue peinture saisie sur un bail SANS caution peinture n'avait
  // jusqu'ici aucun effet réel — `checkAdditionalDepositRefunds`/`finalizeAdditionalDeposits` ignorent
  // silencieusement tout type sans caution `held` correspondante (voir leaseDeposits.js), donc ce
  // montant n'entrait jamais dans `totalDeductions`/`netRefund` ni dans aucune écriture GL, alors que le
  // PV l'affichait comme une retenue bien réelle. Bloqué dès la saisie plutôt que de laisser un montant
  // fantôme s'afficher sur un document officiel.
  if (data.peintureDeductionAmount > 0) {
    const deposits = await listLeaseDeposits(tenantId, leaseId, pool);
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
  const additionalDeposits = await listLeaseDeposits(tenantId, leaseId);
  const lease = await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const statement = await computeMoveOutStatement(pool, { tenantId: tenantId, lease, report: row, deposits: additionalDeposits });
  return { row, additionalDeposits, statement };
}

/** Ajoute une photo (3 maximum) à un élément du brouillon. */
async function addMoveOutPhoto(tenantId, leaseId, scopeAgentId, zoneKey, itemKey, file) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  assertDraft(report, 'état des lieux de sortie');

  const zones = normalizeStoredItems(report.items);
  const found = findItem(zones, zoneKey, itemKey);
  if (!found) throw new ApiError(404, 'Élément introuvable sur cette fiche');
  if (found.item.photoUrls.length >= 3) {
    throw new ApiError(400, 'Maximum 3 photos par élément — supprimez-en une avant d’en ajouter une nouvelle.');
  }

  const rel = await saveInspectionFile(tenantId, leaseId, file, 'photo', 'Photo');
  found.item.photoUrls.push(toProtectedFileUrl(rel));

  await pool.query('UPDATE move_out_reports SET items = :items WHERE lease_id = :leaseId', {
    items: JSON.stringify({ zones }),
    leaseId,
  });

  const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  return row;
}

/** Supprime une photo d'un élément du brouillon. */
async function deleteMoveOutPhoto(tenantId, leaseId, scopeAgentId, zoneKey, itemKey, photoIndex) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  assertDraft(report, 'état des lieux de sortie');

  const zones = normalizeStoredItems(report.items);
  const found = findItem(zones, zoneKey, itemKey);
  if (!found) throw new ApiError(404, 'Élément introuvable sur cette fiche');
  if (photoIndex >= found.item.photoUrls.length) throw new ApiError(404, 'Photo introuvable');

  const [oldPath] = found.item.photoUrls.splice(photoIndex, 1);
  await pool.query('UPDATE move_out_reports SET items = :items WHERE lease_id = :leaseId', {
    items: JSON.stringify({ zones }),
    leaseId,
  });
  if (oldPath) await deleteInspectionFile(stripFileUrlPrefix(oldPath));

  const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  return row;
}

/** Verrouille la fiche, fige le décompte de caution, termine le bail et libère l'unité — une seule transaction. */
async function finalizeMoveOut(tenantId, userId, leaseId, scopeAgentId, { tenantSignatureFile, agentSignatureFile, body }) {
  const conn = await pool.getConnection();
  try {
    const lease = await loadLease(conn, tenantId, leaseId, scopeAgentId);
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
    const readRefundMethod = (field) => (REFUND_METHODS.includes(body?.[field]) ? body[field] : undefined);

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
            tenantId: tenantId,
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
    const balanceNote = typeof body?.balanceNote === 'string' && body.balanceNote.trim() ? body.balanceNote.trim().slice(0, 255) : null;
    if (shortfall > 0) {
      if (isCorrection) {
        balanceResolution = report.balance_resolution;
        balancePaymentMethod = report.balance_payment_method;
      } else {
        balanceResolution = ['paid', 'repairs_by_tenant'].includes(body?.balanceResolution) ? body.balanceResolution : null;
        if (!balanceResolution) {
          throw new ApiError(400, `Le locataire doit encore ${shortfall} FCFA : indiquez s'il règle la différence ou s'il effectue les réparations.`);
        }
        if (balanceResolution === 'paid') {
          balancePaymentMethod = REFUND_METHODS.includes(body?.balancePaymentMethod) ? body.balancePaymentMethod : null;
          if (!balancePaymentMethod) throw new ApiError(400, 'Indiquez comment le locataire règle la différence.');
        }
      }
    }

    // Module comptabilité SYSCOHADA (nouveau) : mode de règlement requis
    // seulement s'il reste réellement quelque chose à reverser (une
    // caution intégralement absorbée par des retenues n'implique aucun
    // mouvement de trésorerie). Voir routes/renters.js `recordDepositReceived`
    // pour la réception — même principe, symétrique.
    const refundPaymentMethod = typeof body?.refundPaymentMethod === 'string' ? body.refundPaymentMethod : '';
    if (netRefund > 0 && !REFUND_METHODS.includes(refundPaymentMethod)) {
      throw new ApiError(400, 'Mode de règlement requis pour la restitution de la caution');
    }

    const tenantSignaturePath = tenantSignatureFile ? await saveInspectionFile(tenantId, leaseId, tenantSignatureFile, 'signature-locataire', 'Signature') : null;
    const agentSignaturePath = agentSignatureFile ? await saveInspectionFile(tenantId, leaseId, agentSignatureFile, 'signature-agent', 'Signature') : null;
    const tenantReserves =
      typeof body?.tenantReserves === 'string' && body.tenantReserves.trim()
        ? body.tenantReserves.trim().slice(0, 2000)
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
    await assertPeriodOpen(tenantId, report.conducted_at);

    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, tenantId, report.conducted_at);

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
        by: userId,
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
        tenantId: tenantId,
        leaseId,
        moveOutDate: report.conducted_at,
        peintureDeductionAmount: Number(report.peinture_deduction_amount),
        peintureDeductionNote: report.peinture_deduction_note,
        refundMethods: additionalDepositRefundMethods,
        renterName,
        createdBy: userId,
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
              tenantId: tenantId,
              leaseId,
              coversMonth: arrearsIsCalendaire ? alloc.coversMonth : null,
              coversPeriodStart,
              amount: alloc.amount,
              paidAt: report.conducted_at,
              notes: 'Réglé par la caution à la sortie',
              recordedBy: userId,
            },
          );
        }
      }
    }
    finalizedAdditionalDeposits = await listLeaseDeposits(tenantId, leaseId, conn);

    // Module comptabilité SYSCOHADA (nouveau) — restitution SIMPLE
    // uniquement (aucune retenue) : le sort comptable d'une retenue sur
    // caution (produit du cabinet ? compensation pour le propriétaire ?)
    // est un choix de jugement comptable non tranché (voir seed, règle
    // `caution_restituee`) — jamais inventé ici. Avec retenue, la caution
    // reste "à régulariser manuellement" — désormais aussi signalée
    // durablement dans « Mes tâches » (routes/tasks.js) tant que personne
    // ne l'a marquée réglée, pas seulement dans cette réponse ponctuelle.
    let depositAccountingNote = null;
    if (await isModuleActive(conn, tenantId)) {
      if (totalDeductions === 0 && netRefund > 0) {
        await genererEcriture(conn, {
          tenantId: tenantId,
          operationType: 'caution_restituee',
          entryDate: report.conducted_at,
          amount: netRefund,
          paymentMethod: refundPaymentMethod,
          narrationVars: { locataire: renterName },
          sourceTable: 'move_out_reports',
          sourceId: report.id,
          createdBy: userId,
          context: { leaseId },
        });
      } else if (depositAmount > 0) {
        depositAccountingNote = rentArrearsAmount > 0
          ? `Caution avec retenue (dont ${rentArrearsAmount} FCFA d'arriérés de loyer réglés via la caution) : à régulariser manuellement dans Comptabilité avancée → Journal → Écriture diverse (le sort comptable d'une retenue sur caution n'est pas encore automatisé). Ce rappel reste visible dans « Mes tâches » jusqu'à ce qu'il soit marqué réglé.`
          : 'Caution avec retenue : à régulariser manuellement dans Comptabilité avancée → Journal → Écriture diverse (le sort comptable d\'une retenue sur caution n\'est pas encore automatisé). Ce rappel reste visible dans « Mes tâches » jusqu\'à ce qu\'il soit marqué réglé.';
      }
    }

    await conn.commit();
    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    return { row, depositAccountingNote, additionalDeposits: finalizedAdditionalDeposits, totalDeductions, netRefund };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Rouvre une fiche finalisée (DG) ; extourne l'écriture « caution restituée » si elle existe. */
async function reopenMoveOut(tenantId, userId, leaseId, reason) {
  const conn = await pool.getConnection();
  try {
    await loadLease(conn, tenantId, leaseId, null);
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
    const moduleActiveBeforeTx = await isModuleActive(conn, tenantId);
    let entryToReverseId = null;
    if (moduleActiveBeforeTx) {
      const [[entry]] = await conn.query(
        `SELECT id FROM gl_entries
         WHERE tenant_id = :tenantId AND source_table = 'move_out_reports' AND source_id = :reportId AND status = 'validee'
         LIMIT 1`,
        { tenantId: tenantId, reportId: report.id },
      );
      entryToReverseId = entry?.id ?? null;
      if (entryToReverseId) await assertPeriodOpen(tenantId, todayIso);
    }

    await conn.beginTransaction();

    if (entryToReverseId) {
      await assertPeriodOpenLocked(conn, tenantId, todayIso);
      await extourneEcriture(conn, {
        tenantId: tenantId,
        entryId: entryToReverseId,
        entryDate: todayIso,
        userId: userId,
        reason: `État des lieux de sortie rouvert pour correction : ${reason}`,
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
      { by: userId, reason: reason, leaseId, snapshot: JSON.stringify(snapshot) },
    );

    await conn.commit();
    await deleteInspectionFile(report.tenant_signature_path);
    await deleteInspectionFile(report.agent_signature_path);
    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    const additionalDeposits = await listLeaseDeposits(tenantId, leaseId);
    return { row, additionalDeposits };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Marque comme réglée la régularisation comptable manuelle d'une caution avec retenue. */
async function regularizeMoveOutGl(tenantId, userId, leaseId, scopeAgentId) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  assertFinalized(report, 'état des lieux de sortie');
  if (Number(report.total_deductions) <= 0) {
    throw new ApiError(400, 'Cette sortie ne nécessite aucune régularisation manuelle.');
  }

  await pool.query(
    `UPDATE move_out_reports SET gl_regularized_at = NOW(), gl_regularized_by = :by WHERE lease_id = :leaseId`,
    { by: userId, leaseId },
  );

  const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  return row;
}

/** Données du PV de sortie (fiche finalisée uniquement). */
async function getMoveOutPdfData(tenantId, leaseId, scopeAgentId) {
  const lease = await loadLease(pool, tenantId, leaseId, scopeAgentId);

  const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  if (!row) throw new ApiError(404, "Aucun état des lieux de sortie pour ce bail");
  if (row.status !== 'finalized') {
    throw new ApiError(400, 'Cette fiche doit être finalisée (signée) avant de générer le PV.');
  }

  const [renterRows] = await pool.query('SELECT * FROM renters WHERE id = :id LIMIT 1', { id: lease.renter_id });
  const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', {
    id: tenantId,
  });

  // Fiche d'entrée : pour expliquer, à côté de chaque élément facturé, la
  // transition d'état qui a motivé la facturation ("Bon état → Mauvais
  // état"). Sans fiche d'entrée (rare — bail créé avant l'état des lieux
  // par zones), le PV affiche simplement l'état de sortie, sans comparaison.
  const moveInRow = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  const moveInZones = moveInRow ? normalizeStoredItems(moveInRow.items) : [];
  const additionalDeposits = await listLeaseDeposits(tenantId, leaseId);
  const issuance = await getOrCreateIssuance(tenantId, 'etat_lieux_sortie', leaseId);
  return { lease, row, renter: renterRows[0], tenant: tenantRows[0], moveInZones, additionalDeposits, issuance };
}

module.exports = {
  getMoveOutReport,
  startMoveOutReport,
  updateMoveOutDraft,
  addMoveOutPhoto,
  deleteMoveOutPhoto,
  finalizeMoveOut,
  reopenMoveOut,
  regularizeMoveOutGl,
  getMoveOutPdfData,
};
