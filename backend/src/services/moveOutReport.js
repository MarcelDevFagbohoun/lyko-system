'use strict';

/**
 * État des lieux de SORTIE — lecture, brouillon, photos. (La finalisation, la réouverture, la
 * régularisation comptable et le PDF sont dans la suite de ce module.) Les routes gardent la
 * validation, les logs, le périmètre agent et la mise en forme publique (`toPublicMoveOutReport`).
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { loadLease } = require('./rentPayments');
const { computeArrears } = require('./rentTracking');
const { listLeaseDeposits } = require('./leaseDeposits');
const { computeMoveOutStatement } = require('./moveOutStatement');
const {
  cloneMasterZones,
  cloneZonesFrom,
  normalizeStoredItems,
  findItem,
  sumDeductions,
  recomputeItemDeductions,
} = require('./inspection');
const { toProtectedFileUrl, stripFileUrlPrefix } = require('../utils/uploads');
const {
  loadInspectionReportRow,
  assertDraft,
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

module.exports = {
  getMoveOutReport,
  startMoveOutReport,
  updateMoveOutDraft,
  addMoveOutPhoto,
  deleteMoveOutPhoto,
};
