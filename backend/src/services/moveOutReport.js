'use strict';

/**
 * État des lieux de SORTIE — lecture, brouillon, photos, finalisation (cautions, arriérés, GL),
 * réouverture, régularisation comptable manuelle, données PDF. Les routes gardent la validation,
 * les logs, le périmètre agent et la mise en forme publique (`toPublicMoveOutReport`).
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { loadLease } = require('./rentPayments');
const { assertLeaseNotArchived } = require('./leaseGuards');
const { computeArrears, allocateRentPayment, computeRentOwed } = require('./rentTracking');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('./accountingPeriods');
const { getOrCreateIssuance } = require('./documentIssuance');
const { genererEcriture, isModuleActive } = require('./gl/glPostingService');
const { extourneEcriture } = require('./gl/glReversalService');
const { assertManualPaymentAllowed } = require('./payments/manualGuard');
const {
  listLeaseDeposits,
  checkAdditionalDepositRefunds,
  finalizeAdditionalDeposits,
} = require('./leaseDeposits');
const { computeMoveOutStatement } = require('./moveOutStatement');
const {
  cloneMasterZones,
  cloneZonesFrom,
  mergeMoveInZones,
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
const { sendPushToUser } = require('./push/sendPush');
const { notifyLeaseStaff } = require('./push/notifyLeaseEvent');

/** Rôle de l'utilisateur ayant conduit/soumis la fiche — pour savoir si le circuit de revue DG s'applique. */
async function loadUserRole(conn, userId) {
  if (!userId) return null;
  const [[row]] = await conn.query('SELECT role FROM users WHERE id = :id LIMIT 1', { id: userId });
  return row?.role ?? null;
}

/** Ajoute une entrée en AJOUT SEUL au journal `review_history` (jamais réécrit) — l'historique visible demandé. */
function appendReviewHistory(existing, entry) {
  const history = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
  history.push({ at: new Date().toISOString(), ...entry });
  return JSON.stringify(history);
}

async function actorLabel(db, userId) {
  const [[row]] = await db.query('SELECT first_name, last_name, role FROM users WHERE id = :id LIMIT 1', { id: userId });
  if (!row) return { id: userId, name: 'Utilisateur', role: null };
  return { id: userId, name: `${row.first_name} ${row.last_name}`, role: row.role };
}

/** Fiche de sortie (ou null) + arriérés en cours + cautions supplémentaires + décompte (brouillon seulement). */
async function getMoveOutReport(tenantId, leaseId, scopeAgentId) {
  const lease = await loadLease(pool, tenantId, leaseId, scopeAgentId);
  let row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);

  // Auto-guérison (demande utilisateur, 2026-11-03) : `cloneZonesFrom` ne recopie la structure de
  // l'entrée qu'AU DÉMARRAGE de la fiche de sortie (`startMoveOutReport`) — si l'entrée a été démarrée ou
  // complétée APRÈS, ou avec des éléments personnalisés ajoutés ensuite, ces éléments n'apparaissaient
  // jamais côté sortie. Ici, à CHAQUE ouverture du brouillon, on fusionne et on persiste immédiatement
  // tout élément d'entrée encore manquant — jamais touché un élément déjà évalué côté sortie (voir
  // `mergeMoveInZones`). Sans effet sur une fiche déjà finalisée (voir `finalizeMoveOut` pour le
  // garde-fou équivalent qui bloque la finalisation elle-même si quelque chose manque encore).
  if (row && row.status === 'draft') {
    const moveInRow = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
    if (moveInRow) {
      const { zones: mergedZones, added } = mergeMoveInZones(normalizeStoredItems(row.items), normalizeStoredItems(moveInRow.items));
      if (added) {
        await pool.query('UPDATE move_out_reports SET items = :items WHERE lease_id = :leaseId', {
          items: JSON.stringify({ zones: mergedZones }),
          leaseId,
        });
        row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
      }
    }
  }

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
  assertLeaseNotArchived(lease);
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

/**
 * Enregistre le brouillon (zones, retenues, notes) et renvoie fiche + cautions + décompte.
 * `actorUserId` : si fourni ET que la fiche a déjà été soumise au moins une fois (`review_status`
 * 'submitted'/'rejected'), la modification est JOURNALISÉE dans `review_history` (demande utilisateur,
 * 2026-11-03 : « il peut modifier les champs mais doit être traçable ») — comparaison avant/après avec
 * les mêmes helpers que la correction post-finalisation (`diffInspectionReport`), jamais réécrite.
 */
async function updateMoveOutDraft(tenantId, leaseId, scopeAgentId, data, actorUserId = null) {
  assertLeaseNotArchived(await loadLease(pool, tenantId, leaseId, scopeAgentId));
  const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  assertDraft(report, 'état des lieux de sortie');
  const trackChanges = actorUserId && ['submitted', 'rejected'].includes(report.review_status);
  const snapshotBefore = trackChanges
    ? snapshotForCorrection(normalizeStoredItems(report.items), report.general_notes, report.tenant_reserves)
    : null;

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

  if (trackChanges) {
    const snapshotAfter = snapshotForCorrection(data.zones, data.generalNotes, report.tenant_reserves);
    const changedFields = diffInspectionReport(snapshotBefore, snapshotAfter);
    if (changedFields.length > 0) {
      const by = await actorLabel(pool, actorUserId);
      await pool.query('UPDATE move_out_reports SET review_history = :history WHERE lease_id = :leaseId', {
        history: appendReviewHistory(report.review_history, { type: 'edited', by, changedFields }),
        leaseId,
      });
    }
  }

  const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  const additionalDeposits = await listLeaseDeposits(tenantId, leaseId);
  const lease = await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const statement = await computeMoveOutStatement(pool, { tenantId: tenantId, lease, report: row, deposits: additionalDeposits });
  return { row, additionalDeposits, statement };
}

/**
 * Soumet le PV pour validation DG (demande utilisateur, 2026-11-03) — un employé (role <> 'dg') ne
 * finalise plus seul : il soumet, le DG est notifié, peut modifier (tracé) puis valider ou rejeter avec
 * une note. Peut être resoumis plusieurs fois (après un rejet) — chaque soumission ajoute une entrée à
 * `review_history`, jamais réécrite.
 */
async function submitMoveOutReport(tenantId, userId, leaseId, scopeAgentId) {
  const lease = await loadLease(pool, tenantId, leaseId, scopeAgentId);
  assertLeaseNotArchived(lease);
  const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  assertDraft(report, 'état des lieux de sortie');

  // Garde-fou (demande utilisateur, 2026-11-03) : même fusion que `getMoveOutReport`, en mémoire
  // seulement (pas persistée ici) — si l'employé soumet sans être repassé par l'écran d'édition depuis
  // le dernier changement de l'entrée, les éléments manquants sont quand même détectés et bloquent la
  // soumission plutôt que de laisser un élément de l'entrée jamais évalué à la sortie.
  const moveInRowForMerge = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  const zones = moveInRowForMerge
    ? mergeMoveInZones(normalizeStoredItems(report.items), normalizeStoredItems(moveInRowForMerge.items)).zones
    : normalizeStoredItems(report.items);
  const missing = getMissingConditionLabels(zones);
  if (missing.length > 0) {
    throw new ApiError(400, `État manquant pour : ${missing.join(', ')}`);
  }

  const by = await actorLabel(pool, userId);
  await pool.query(
    `UPDATE move_out_reports
     SET review_status = 'submitted', submitted_at = NOW(), submitted_by = :by,
         review_note = NULL, review_history = :history
     WHERE lease_id = :leaseId`,
    {
      by: userId,
      history: appendReviewHistory(report.review_history, { type: 'submitted', by }),
      leaseId,
    },
  );

  const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  // Notification DG — jamais bloquante pour la soumission elle-même.
  notifyLeaseStaff(tenantId, null, {
    title: 'PV de sortie à valider',
    body: `${by.name} a soumis un PV de sortie — bail #${leaseId}`,
    url: `/espace/locataires/${lease.renter_id ?? ''}`,
    tag: `move-out-submitted-${leaseId}`,
  }).catch(() => {});
  return { row };
}

/**
 * Rejette le PV soumis (DG uniquement), avec une note obligatoire — le PV repasse en brouillon
 * modifiable et peut être resoumis plusieurs fois. Notifie l'employé qui l'avait soumis.
 */
async function rejectMoveOutReview(tenantId, userId, leaseId, note) {
  const lease = await loadLease(pool, tenantId, leaseId, null);
  assertLeaseNotArchived(lease);
  const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  assertDraft(report, 'état des lieux de sortie');
  if (report.review_status !== 'submitted') {
    throw new ApiError(400, "Ce PV n'est pas en attente de validation.");
  }

  const by = await actorLabel(pool, userId);
  await pool.query(
    `UPDATE move_out_reports
     SET review_status = 'rejected', reviewed_at = NOW(), reviewed_by = :by, review_note = :note, review_history = :history
     WHERE lease_id = :leaseId`,
    {
      by: userId,
      note,
      history: appendReviewHistory(report.review_history, { type: 'rejected', by, note }),
      leaseId,
    },
  );

  const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  if (report.submitted_by) {
    sendPushToUser(report.submitted_by, {
      title: 'PV de sortie renvoyé',
      body: `${by.name} a renvoyé votre PV de sortie : ${note}`,
      url: `/espace/locataires/${lease.renter_id ?? ''}`,
      tag: `move-out-rejected-${leaseId}`,
    }).catch(() => {});
  }
  return { row };
}

/**
 * Archivage manuel du locataire sortant (migration 140, demande utilisateur 2026-11-03 : « une fois
 * le paiement effectué on doit avoir un bouton archivé... sans ça le locataire ne peut aller dans
 * l'archive »). Geste explicite du DG OU du comptable (jamais automatique) — exige que le PV soit
 * finalisé ET que le décaissement ne soit plus en attente (`payout_status` 'paid' ou
 * 'not_applicable' ; jamais 'pending'). Tant que ce flag n'est pas posé, le dossier reste visible
 * dans la boîte « État des lieux » (`listInProgressInspections`, services/inspection.js) et le
 * locataire n'apparaît pas dans l'onglet Archives (voir services/renters.js `listRenters`).
 */
async function archiveMoveOut(tenantId, userId, leaseId, scopeAgentId) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId); // vérifie le périmètre agent (404/403 si hors portée)
  const report = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  assertFinalized(report, 'état des lieux de sortie');
  if (report.payout_status === 'pending') {
    throw new ApiError(400, "Le décaissement (restitution de caution ou complément) doit d'abord être réglé avant d'archiver.");
  }

  const [[leaseRow]] = await pool.query('SELECT archived_at FROM leases WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
    id: leaseId,
    tenantId,
  });
  if (!leaseRow) throw new ApiError(404, 'Bail introuvable');
  if (leaseRow.archived_at) throw new ApiError(409, 'Ce locataire est déjà archivé.');

  await pool.query('UPDATE leases SET archived_at = NOW(), archived_by = :by WHERE id = :id', { by: userId, id: leaseId });

  const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
  return { row };
}

/** Ajoute une photo (3 maximum) à un élément du brouillon. */
async function addMoveOutPhoto(tenantId, leaseId, scopeAgentId, zoneKey, itemKey, file) {
  assertLeaseNotArchived(await loadLease(pool, tenantId, leaseId, scopeAgentId));
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
  assertLeaseNotArchived(await loadLease(pool, tenantId, leaseId, scopeAgentId));
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
async function finalizeMoveOut(tenantId, userId, leaseId, scopeAgentId, { body }) {
  const conn = await pool.getConnection();
  try {
    const lease = await loadLease(conn, tenantId, leaseId, scopeAgentId);
    assertLeaseNotArchived(lease);
    const report = await loadInspectionReportRow(conn, 'move_out_reports', leaseId);
    assertDraft(report, 'état des lieux de sortie');
    // Une fiche déjà rouverte une fois (étape 48, correction DG) a déjà
    // terminé le bail et libéré l'unité lors de sa PREMIÈRE finalisation —
    // on ne rejoue jamais ces effets de bord une seconde fois, seul le
    // contenu de la fiche (grille, retenues) est corrigé.
    const isCorrection = !!report.reopened_at;
    if (!isCorrection && lease.status !== 'active') throw new ApiError(400, 'Ce bail est déjà terminé');

    // Circuit de validation DG (demande utilisateur, 2026-11-03) : un PV saisi par un EMPLOYÉ (pas le
    // DG lui-même) doit avoir été SOUMIS avant de pouvoir être finalisé, et seul le DG peut le
    // finaliser (= le valider) — jamais rejoué sur une correction (`isCorrection`, déjà DG-only via
    // `canReopenInspection`). Le DG qui conduit lui-même sa propre sortie continue de finaliser
    // directement, sans passer par la soumission (demande explicite : « seulement ceux saisis par un
    // employé »).
    let authorIsDg = true;
    if (!isCorrection) {
      const authorRole = await loadUserRole(conn, report.conducted_by);
      authorIsDg = authorRole === 'dg';
      if (!authorIsDg) {
        const actorRole = await loadUserRole(conn, userId);
        if (actorRole !== 'dg') {
          throw new ApiError(403, 'Seul le DG peut valider ce PV — soumettez-le pour validation (« Soumettre pour validation »).');
        }
        if (report.review_status !== 'submitted') {
          throw new ApiError(400, "Ce PV doit d'abord être soumis pour validation avant de pouvoir être finalisé.");
        }
      }
    }

    // Garde-fou final (demande utilisateur, 2026-11-03) : même fusion qu'à la soumission/l'édition — en
    // mémoire seulement — pour qu'un PV ne puisse JAMAIS être validé si un élément vérifié à l'entrée n'a
    // pas été évalué à la sortie, quel que soit le chemin suivi pour arriver jusqu'ici.
    const moveInRowForMerge = isCorrection ? null : await loadInspectionReportRow(conn, 'move_in_reports', leaseId);
    const zones = moveInRowForMerge
      ? mergeMoveInZones(normalizeStoredItems(report.items), normalizeStoredItems(moveInRowForMerge.items)).zones
      : normalizeStoredItems(report.items);
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

    // Décaissement réel (migration 139) : le cas SIMPLE (aucune retenue) reste posté immédiatement ici
    // (comportement historique inchangé, voir plus bas) — `payoutStatus` vaut alors directement 'paid'.
    // Avec une retenue, ou un complément dû par le locataire, RIEN n'est payé/encaissé ici : seul le
    // bouton dédié (« Payer le locataire »/« Encaisser le complément », `recordTenantPayout` ci-dessous)
    // déclenche le vrai mouvement de caisse et l'écriture comptable.
    let payoutDirection = null;
    let payoutStatus = 'not_applicable';
    let payoutAmount = null;
    if (netRefund > 0) {
      payoutDirection = 'refund_to_tenant';
      payoutAmount = netRefund;
      payoutStatus = totalDeductions === 0 ? 'paid' : 'pending';
    } else if (shortfall > 0 && balanceResolution === 'paid') {
      payoutDirection = 'collect_from_tenant';
      payoutAmount = shortfall;
      payoutStatus = 'pending';
    } else if (shortfall === 0) {
      // Bug corrigé avant même la première exécution (relecture du 2026-11-03) : `totalDeductions ===
      // depositAmount` EXACTEMENT (caution entièrement absorbée par les dégâts, rien à rendre NI à
      // encaisser) laissait `payoutStatus` à 'not_applicable' — la retenue n'était alors JAMAIS créditée
      // au propriétaire et la caution (compte 165) jamais éteinte, sans aucune alerte pour le signaler.
      // La retenue reste due au propriétaire même quand `netRefund` vaut 0 : direction
      // 'refund_to_tenant' avec un montant à verser de 0 — le bouton « Payer le locataire » poste alors
      // l'écriture d'extinction sans aucun mouvement de trésorerie réel (voir `recordTenantPayout`).
      // Cas `shortfall > 0 && balanceResolution === 'repairs_by_tenant'` (le locataire répare lui-même) :
      // volontairement hors périmètre, comme avant cette fonctionnalité — aucune écriture automatique.
      payoutDirection = totalDeductions > 0 ? 'refund_to_tenant' : null;
      payoutAmount = netRefund;
      payoutStatus = totalDeductions > 0 ? 'pending' : 'not_applicable';
    }
    const authorLabelForHistory = isCorrection ? null : authorIsDg ? null : await actorLabel(conn, userId);
    const reviewHistory = authorLabelForHistory
      ? appendReviewHistory(report.review_history, { type: 'validated', by: authorLabelForHistory })
      : report.review_history;

    await conn.query(
      `UPDATE move_out_reports
       SET status = 'finalized', finalized_at = NOW(), finalized_by = :by,
           tenant_reserves = :tenantReserves,
           total_deductions = :totalDeductions, net_refund = :netRefund, refund_payment_method = :refundMethod,
           peinture_overflow_amount = :peintureOverflow, rent_arrears_amount = :rentArrearsAmount,
           rent_owed_amount = :rentOwedGross, balance_due_amount = :shortfall, balance_resolution = :balanceResolution,
           balance_payment_method = :balancePaymentMethod, balance_note = :balanceNote,
           gl_regularized_at = NULL, gl_regularized_by = NULL,
           correction_changes = :correctionChanges, pre_reopen_snapshot = NULL,
           review_status = :reviewStatus, reviewed_at = :reviewedAt, reviewed_by = :reviewedBy, review_history = :reviewHistory,
           payout_status = :payoutStatus, payout_direction = :payoutDirection, payout_amount = :payoutAmount,
           payout_method = :payoutMethod, payout_paid_at = :payoutPaidAt, payout_paid_by = :payoutPaidBy
       WHERE lease_id = :leaseId`,
      {
        by: userId,
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
        // Une correction (DG, déjà validé plus tôt) ou un PV conduit par le DG lui-même : déjà/toujours
        // 'validated', jamais remis en jeu par cette refinalisation.
        reviewStatus: isCorrection || authorIsDg ? report.review_status === 'draft' ? 'validated' : report.review_status : 'validated',
        reviewedAt: isCorrection || authorIsDg ? report.reviewed_at : new Date(),
        reviewedBy: isCorrection || authorIsDg ? report.reviewed_by : userId,
        reviewHistory,
        payoutStatus,
        payoutDirection,
        payoutAmount,
        // Cas simple sans retenue : déjà payé, le même paiement/méthode que le choix fait ici.
        payoutMethod: payoutStatus === 'paid' ? refundPaymentMethod : null,
        payoutPaidAt: payoutStatus === 'paid' ? new Date() : null,
        payoutPaidBy: payoutStatus === 'paid' ? userId : null,
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

    // Module comptabilité SYSCOHADA — restitution SIMPLE uniquement (aucune retenue) : postée
    // immédiatement, comportement historique inchangé. AVEC retenue ou complément dû par le locataire
    // (migration 139, demande utilisateur 2026-11-03) : plus aucune écriture ici — le bouton « Payer le
    // locataire »/« Encaisser le complément » (`recordTenantPayout`) poste alors `caution_restituee_avec_retenue`
    // ou `complement_sortie_encaisse_proprietaire` au moment du paiement réel, jamais à la seule
    // finalisation. Visible tant que non réglé dans « Mes tâches »/tableau de bord DG, que le module
    // comptabilité soit actif ou non (`listPendingMoveOutPayouts`, services/inspection.js).
    let depositAccountingNote = null;
    if (totalDeductions === 0 && netRefund > 0 && (await isModuleActive(conn, tenantId))) {
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
    } else if (payoutStatus === 'pending') {
      depositAccountingNote = payoutDirection === 'refund_to_tenant'
        ? payoutAmount > 0
          ? `Caution avec retenue${rentArrearsAmount > 0 ? ` (dont ${rentArrearsAmount} FCFA d'arriérés de loyer réglés via la caution)` : ''} : ${payoutAmount} FCFA restent à verser au locataire — bouton « Payer le locataire » sur sa fiche.`
          : 'Caution entièrement absorbée par les dégradations (rien à rendre au locataire) : la retenue doit tout de même être créditée au propriétaire — bouton « Payer le locataire » sur sa fiche.'
        : `Le locataire doit encore ${payoutAmount} FCFA — bouton « Encaisser le complément » sur sa fiche.`;
    } else if (totalDeductions > 0) {
      // Bug corrigé avant même la première exécution (relecture du 2026-11-03) : ce cas (ex.
      // `balanceResolution === 'repairs_by_tenant'`, volontairement hors du nouveau circuit automatisé —
      // voir plus haut) n'affichait PLUS aucun message du tout depuis l'ajout du circuit « Payer le
      // locataire » (perdant le seul signal donné au DG) — message et mécanisme manuel préexistants
      // (`listPendingDepositRegularizations`/« Mes tâches » → marquer réglé) restaurés à l'identique.
      depositAccountingNote = rentArrearsAmount > 0
        ? `Caution avec retenue (dont ${rentArrearsAmount} FCFA d'arriérés de loyer réglés via la caution) : à régulariser manuellement dans Comptabilité avancée → Journal → Écriture diverse (le sort comptable d'une retenue sur caution n'est pas automatisé dans ce cas). Ce rappel reste visible dans « Mes tâches » jusqu'à ce qu'il soit marqué réglé.`
        : 'Caution avec retenue : à régulariser manuellement dans Comptabilité avancée → Journal → Écriture diverse (le sort comptable d\'une retenue sur caution n\'est pas automatisé dans ce cas). Ce rappel reste visible dans « Mes tâches » jusqu\'à ce qu\'il soit marqué réglé.';
    }

    await conn.commit();
    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    if (authorLabelForHistory && report.submitted_by) {
      sendPushToUser(report.submitted_by, {
        title: 'PV de sortie validé',
        body: `${authorLabelForHistory.name} a validé votre PV de sortie.`,
        url: `/espace/locataires/${lease.renter_id ?? ''}`,
        tag: `move-out-validated-${leaseId}`,
      }).catch(() => {});
    }
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
    // Argent déjà réellement mouvementé (« Payer le locataire »/« Encaisser le complément ») — une
    // réouverture rejouerait aveuglément les retenues sans jamais pouvoir annuler ce paiement
    // déjà parti (demande utilisateur implicite : la traçabilité du décaissement doit rester fiable).
    // Corrigé (revue indépendante du 2026-11-04) : le `&& total_deductions > 0` laissait rouvrir sans
    // blocage une restitution intégrale déjà payée (pas de retenue, donc condition fausse) alors que
    // l'argent était bel et bien déjà parti — même risque que pour une retenue. Seul `payout_status`
    // compte : dès que le décaissement est réglé, la fiche ne doit plus pouvoir être rouverte, quel
    // que soit le montant des déductions (ferme aussi le risque de double comptage en trésorerie sur
    // deux mois différents si la fiche était rouverte puis refinalisée).
    if (report.payout_status === 'paid') {
      throw new ApiError(409, 'Le paiement de sortie a déjà été effectué pour ce locataire — cette fiche ne peut plus être rouverte.');
    }

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
           reopened_at = NOW(), reopened_by = :by, reopen_reason = :reason,
           pre_reopen_snapshot = :snapshot, correction_changes = NULL
       WHERE lease_id = :leaseId`,
      { by: userId, reason: reason, leaseId, snapshot: JSON.stringify(snapshot) },
    );
    // Bug corrigé (audit du 2026-11-03) : un locataire déjà archivé (migration 140) dont le PV est
    // rouvert pour correction restait marqué archivé — invisible à la fois de l'onglet Archives (son
    // dossier redevient un brouillon actif, plus un bail "ended" propre) ET de la boîte « État des
    // lieux » (`listInProgressInspections` filtre `leases.archived_at IS NULL`). Lève le flag
    // inconditionnellement : sans effet si le bail n'était pas archivé, et le DG/comptable réarchivera
    // explicitement une fois la correction refinalisée et le décaissement réglé.
    await conn.query('UPDATE leases SET archived_at = NULL, archived_by = NULL WHERE id = :id', { id: leaseId });

    await conn.commit();
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
  assertLeaseNotArchived(await loadLease(pool, tenantId, leaseId, scopeAgentId));
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

/**
 * Décaissement manuel (sans FedaPay) d'un PV finalisé avec retenue/complément en attente (migration 139,
 * demande utilisateur 2026-11-03) : « Payer le locataire » (direction `refund_to_tenant`) ou « Encaisser le
 * complément » (`collect_from_tenant`). Poste la retenue au compte du PROPRIÉTAIRE (jamais en produit du
 * cabinet — décision explicite, voir `caution_restituee_avec_retenue`/`complement_sortie_encaisse_proprietaire`
 * dans db/seedGeneralLedger.js), sans aucune notification au propriétaire (« action interne »).
 */
async function recordTenantPayout(tenantId, userId, leaseId, scopeAgentId, { method, note } = {}) {
  const conn = await pool.getConnection();
  try {
    assertLeaseNotArchived(await loadLease(conn, tenantId, leaseId, scopeAgentId)); // vérifie le périmètre agent (404/403 si hors portée)
    const report = await loadInspectionReportRow(conn, 'move_out_reports', leaseId);
    assertFinalized(report, 'état des lieux de sortie');
    // Corrigé (audit de sécurité du 2026-11-04) : ce chemin manuel contournait le garde-fou FedaPay —
    // avec FedaPay activé, une VRAIE restitution de caution (`refund_to_tenant`, montant > 0) pouvait
    // être déclarée « payée » ici sans que l'argent soit réellement envoyé, alors que le même garde-fou
    // bloque déjà ce contournement pour le salaire (`routes/payslips.js`) et le reversement propriétaire
    // (`services/owners.js::createPayout`). Le cas `payout_amount = 0` (caution entièrement absorbée
    // par les dégâts, rien à envoyer) reste exempté — FedaPay ne peut pas envoyer 0 FCFA, voir le
    // commentaire dans `services/payments/orders.js::resolvePurpose`. `collect_from_tenant` (complément
    // ENCAISSÉ auprès du locataire, pas un envoi FedaPay) n'est pas non plus concerné.
    if (report.payout_direction === 'refund_to_tenant' && Number(report.payout_amount) > 0) {
      await assertManualPaymentAllowed(tenantId, 'la restitution de caution au locataire');
    }
    if (report.payout_status !== 'pending') {
      throw new ApiError(400, "Aucun décaissement en attente pour cette sortie.");
    }
    const REFUND_METHODS = ['especes', 'mobile_money', 'virement', 'cheque'];
    if (!REFUND_METHODS.includes(method)) {
      throw new ApiError(400, 'Mode de règlement requis.');
    }

    const [renterRows] = await conn.query(
      'SELECT r.first_name, r.last_name FROM leases l JOIN renters r ON r.id = l.renter_id WHERE l.id = :leaseId LIMIT 1',
      { leaseId },
    );
    const renterName = renterRows[0] ? `${renterRows[0].first_name} ${renterRows[0].last_name}` : 'Locataire';
    const paidAtIso = new Date().toISOString().slice(0, 10);
    await assertPeriodOpen(tenantId, paidAtIso);

    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, tenantId, paidAtIso);

    // Verrou anti-double-soumission (audit du flux de décaissement, 2026-11-03) : le chemin FedaPay
    // (services/payments/orders.js) verrouille déjà la ligne avant de rejouer la vérification — ce
    // chemin manuel ne le faisait pas, donc un double-clic ou une double requête pouvait passer la
    // vérification `payout_status === 'pending'` faite plus haut DEUX FOIS avant que l'une des deux
    // ne commette. En mode comptabilité simple (sans SYSCOHADA), rien ne l'empêchait alors : aucune
    // écriture GL pour le bloquer via la contrainte d'unicité `source_table`/`source_id`. On revérifie
    // donc sous verrou, à l'intérieur de la transaction, et on abandonne proprement si quelqu'un d'autre
    // a déjà réglé ce décaissement entre-temps.
    const [[lockedReport]] = await conn.query(
      "SELECT payout_status FROM move_out_reports WHERE lease_id = :leaseId FOR UPDATE",
      { leaseId },
    );
    if (!lockedReport || lockedReport.payout_status !== 'pending') {
      throw new ApiError(409, 'Ce décaissement a déjà été réglé par quelqu’un d’autre.');
    }

    if (await isModuleActive(conn, tenantId)) {
      if (report.payout_direction === 'refund_to_tenant') {
        await genererEcriture(conn, {
          tenantId,
          operationType: 'caution_restituee_avec_retenue',
          entryDate: paidAtIso,
          amount: Number(report.deposit_amount),
          paymentMethod: method,
          narrationVars: { locataire: renterName },
          sourceTable: 'move_out_reports',
          sourceId: report.id,
          createdBy: userId,
          context: { leaseId, retenueAmount: Number(report.total_deductions) },
        });
      } else {
        // Bug corrigé avant même la première exécution (relecture du 2026-11-03) : quand les dégâts
        // DÉPASSENT la caution (`collect_from_tenant`), la caution (165) n'était jamais éteinte ni sa
        // part créditée au propriétaire — seul le COMPLÉMENT collecté auprès du locataire l'était.
        // Deux écritures, dans la même transaction : (1) extinction de la caution, intégralement
        // créditée au propriétaire (`retenueAmount` = le dépôt en entier, `netRefund` = 0 par
        // construction ici, donc rien à rendre) ; (2) le complément au-delà de la caution, encaissé
        // auprès du locataire et lui aussi entièrement crédité au propriétaire (même traitement que la
        // retenue — sert à la remise en état, jamais un produit du cabinet).
        await genererEcriture(conn, {
          tenantId,
          operationType: 'caution_restituee_avec_retenue',
          entryDate: paidAtIso,
          amount: Number(report.deposit_amount),
          paymentMethod: method,
          narrationVars: { locataire: renterName },
          sourceTable: 'move_out_reports',
          sourceId: report.id,
          createdBy: userId,
          context: { leaseId, retenueAmount: Number(report.deposit_amount) },
        });
        await genererEcriture(conn, {
          tenantId,
          operationType: 'complement_sortie_encaisse_proprietaire',
          entryDate: paidAtIso,
          amount: Number(report.payout_amount),
          paymentMethod: method,
          narrationVars: { locataire: renterName },
          sourceTable: 'move_out_reports',
          sourceId: report.id,
          createdBy: userId,
          context: { leaseId },
        });
      }
    }

    const by = await actorLabel(conn, userId);
    const [updateResult] = await conn.query(
      `UPDATE move_out_reports
       SET payout_status = 'paid', payout_method = :method, payout_paid_at = NOW(), payout_paid_by = :by,
           review_history = :history
       WHERE lease_id = :leaseId AND payout_status = 'pending'`,
      {
        method,
        by: userId,
        history: appendReviewHistory(report.review_history, {
          type: report.payout_direction === 'refund_to_tenant' ? 'tenant_paid' : 'balance_collected',
          by,
          amount: Number(report.payout_amount),
          method,
          note: note || null,
        }),
        leaseId,
      },
    );
    // Garde-fou final, même principe que `extourneEcriture`/`payIrf`/`payLiability`/`payVat` : si la
    // ligne a changé entre le verrou ci-dessus et cet UPDATE (ne devrait jamais arriver, le verrou
    // tient toute la transaction), on ne commet jamais une écriture déjà postée sans sa mise à jour.
    if (updateResult.affectedRows !== 1) {
      throw new ApiError(409, 'Ce décaissement a déjà été réglé par quelqu’un d’autre.');
    }

    await conn.commit();
    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    return { row };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Frais de service de l'agence, prélevés sur le solde propriétaire déjà crédité pour une réparation
 * (demande utilisateur, 2026-11-03) : montant LIBRE saisi par le DG à chaque fois (jamais un taux fixe),
 * devient un vrai produit du cabinet (compte 706) — visible dans le tableau de bord/recette. Exige que le
 * décaissement ait déjà été effectué (le propriétaire doit déjà avoir été crédité) ; une seule fois par PV.
 */
async function chargeRepairFee(tenantId, userId, leaseId, scopeAgentId, { amount, note } = {}) {
  const conn = await pool.getConnection();
  try {
    assertLeaseNotArchived(await loadLease(conn, tenantId, leaseId, scopeAgentId));
    const report = await loadInspectionReportRow(conn, 'move_out_reports', leaseId);
    assertFinalized(report, 'état des lieux de sortie');
    if (report.payout_status !== 'paid') {
      throw new ApiError(400, "Le propriétaire doit d'abord être crédité (décaissement effectué) avant de prélever des frais de service.");
    }
    if (report.repair_fee_charged_at) {
      throw new ApiError(409, 'Des frais de service ont déjà été prélevés sur ce PV.');
    }
    const feeAmount = Number(amount);
    if (!Number.isFinite(feeAmount) || feeAmount <= 0) {
      throw new ApiError(400, 'Montant des frais de service invalide.');
    }

    const [renterRows] = await conn.query(
      'SELECT r.first_name, r.last_name FROM leases l JOIN renters r ON r.id = l.renter_id WHERE l.id = :leaseId LIMIT 1',
      { leaseId },
    );
    const renterName = renterRows[0] ? `${renterRows[0].first_name} ${renterRows[0].last_name}` : 'Locataire';
    const chargedAtIso = new Date().toISOString().slice(0, 10);
    await assertPeriodOpen(tenantId, chargedAtIso);

    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, tenantId, chargedAtIso);

    if (await isModuleActive(conn, tenantId)) {
      await genererEcriture(conn, {
        tenantId,
        operationType: 'frais_reparation_preleve_proprietaire',
        entryDate: chargedAtIso,
        amount: feeAmount,
        paymentMethod: null,
        narrationVars: { locataire: renterName },
        sourceTable: 'move_out_reports',
        sourceId: report.id,
        createdBy: userId,
        context: { leaseId },
      });
    }

    const feeNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 255) : null;
    const by = await actorLabel(conn, userId);
    await conn.query(
      `UPDATE move_out_reports
       SET repair_fee_amount = :amount, repair_fee_note = :note, repair_fee_charged_at = NOW(), repair_fee_charged_by = :by,
           review_history = :history
       WHERE lease_id = :leaseId`,
      {
        amount: feeAmount,
        note: feeNote,
        by: userId,
        history: appendReviewHistory(report.review_history, { type: 'repair_fee_charged', by, amount: feeAmount, note: feeNote }),
        leaseId,
      },
    );

    await conn.commit();
    const row = await loadInspectionReportRow(pool, 'move_out_reports', leaseId);
    return { row };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
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
  submitMoveOutReport,
  rejectMoveOutReview,
  addMoveOutPhoto,
  deleteMoveOutPhoto,
  finalizeMoveOut,
  reopenMoveOut,
  regularizeMoveOutGl,
  recordTenantPayout,
  chargeRepairFee,
  archiveMoveOut,
  getMoveOutPdfData,
};
