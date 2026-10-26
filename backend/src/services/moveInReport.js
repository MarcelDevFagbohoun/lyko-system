'use strict';

/**
 * État des lieux d'ENTRÉE : lecture, brouillon, photos, finalisation, réouverture, données PDF.
 * Les routes gardent la validation, les logs, le périmètre agent et la mise en forme publique
 * (`toPublicInspectionReport`) ; ce module porte le SQL, les fichiers et les règles métier.
 * Les fonctions renvoient la ligne brute de la fiche.
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { loadLease } = require('./rentPayments');
const { getOrCreateIssuance } = require('./documentIssuance');
const {
  cloneMasterZones,
  normalizeStoredItems,
  findItem,
  getMissingConditionLabels,
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

/** État des lieux d'entrée (ligne brute, ou null). */
async function getMoveInReport(tenantId, leaseId, scopeAgentId) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  return row;
}

/** Démarre le BROUILLON (une fois par bail), amorcé avec les zones/éléments standards. */
async function startMoveInReport(tenantId, userId, leaseId, scopeAgentId, conductedAt) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);

  const [existing] = await pool.query('SELECT id FROM move_in_reports WHERE lease_id = :leaseId LIMIT 1', {
    leaseId,
  });
  if (existing[0]) throw new ApiError(409, 'Un état des lieux existe déjà pour ce bail');

  const zones = cloneMasterZones();
  await pool.query(
    `INSERT INTO move_in_reports (tenant_id, lease_id, conducted_at, items, status, conducted_by)
     VALUES (:tenantId, :leaseId, :conductedAt, :items, 'draft', :by)`,
    {
      tenantId: tenantId,
      leaseId,
      conductedAt: conductedAt || new Date().toISOString().slice(0, 10),
      items: JSON.stringify({ zones }),
      by: userId,
    },
  );
  const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  return row;
}

/** Enregistre le brouillon (zones, éléments, notes). Refusé une fois finalisée. */
async function updateMoveInDraft(tenantId, leaseId, scopeAgentId, data) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
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
  return row;
}

/** Ajoute une photo (3 maximum) à un élément du brouillon. */
async function addMoveInPhoto(tenantId, leaseId, scopeAgentId, zoneKey, itemKey, file) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const report = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  assertDraft(report, 'état des lieux d’entrée');

  const zones = normalizeStoredItems(report.items);
  const found = findItem(zones, zoneKey, itemKey);
  if (!found) throw new ApiError(404, 'Élément introuvable sur cette fiche');
  // Jusqu'à 3 photos par élément (étape 48) — on ajoute, on ne remplace
  // plus jamais silencieusement une photo existante.
  if (found.item.photoUrls.length >= 3) {
    throw new ApiError(400, 'Maximum 3 photos par élément — supprimez-en une avant d’en ajouter une nouvelle.');
  }

  const rel = await saveInspectionFile(tenantId, leaseId, file, 'photo', 'Photo');
  found.item.photoUrls.push(toProtectedFileUrl(rel));

  await pool.query('UPDATE move_in_reports SET items = :items WHERE lease_id = :leaseId', {
    items: JSON.stringify({ zones }),
    leaseId,
  });

  const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  return row;
}

/** Supprime une photo d'un élément du brouillon. */
async function deleteMoveInPhoto(tenantId, leaseId, scopeAgentId, zoneKey, itemKey, photoIndex) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const report = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  assertDraft(report, 'état des lieux d’entrée');

  const zones = normalizeStoredItems(report.items);
  const found = findItem(zones, zoneKey, itemKey);
  if (!found) throw new ApiError(404, 'Élément introuvable sur cette fiche');
  if (photoIndex >= found.item.photoUrls.length) throw new ApiError(404, 'Photo introuvable');

  const [oldPath] = found.item.photoUrls.splice(photoIndex, 1);
  await pool.query('UPDATE move_in_reports SET items = :items WHERE lease_id = :leaseId', {
    items: JSON.stringify({ zones }),
    leaseId,
  });
  if (oldPath) await deleteInspectionFile(stripFileUrlPrefix(oldPath));

  const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  return row;
}

/** Verrouille la fiche (tous les états renseignés ; signatures numériques facultatives). */
async function finalizeMoveIn(tenantId, userId, leaseId, scopeAgentId, { tenantSignatureFile, agentSignatureFile, tenantReservesInput }) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const report = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  assertDraft(report, 'état des lieux d’entrée');

  const zones = normalizeStoredItems(report.items);
  const missing = getMissingConditionLabels(zones);
  if (missing.length > 0) {
    throw new ApiError(400, `État manquant pour : ${missing.join(', ')}`);
  }

  const tenantSignaturePath = tenantSignatureFile ? await saveInspectionFile(tenantId, leaseId, tenantSignatureFile, 'signature-locataire', 'Signature') : null;
  const agentSignaturePath = agentSignatureFile ? await saveInspectionFile(tenantId, leaseId, agentSignatureFile, 'signature-agent', 'Signature') : null;
  // Réserves du locataire (étape 48) — notées par l'agent à l'oral au
  // moment de la signature, si le locataire n'est pas d'accord sur un
  // point précis ; jamais un accès en écriture du locataire lui-même.
  const tenantReserves =
    typeof tenantReservesInput === 'string' && tenantReservesInput.trim()
      ? tenantReservesInput.trim().slice(0, 2000)
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
      by: userId,
      tenantSig: tenantSignaturePath,
      agentSig: agentSignaturePath,
      tenantReserves,
      leaseId,
      correctionChanges: correctionChanges ? JSON.stringify(correctionChanges) : null,
    },
  );
  const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  return row;
}

/** Rouvre une fiche finalisée (DG, motif obligatoire) ; invalide les signatures. */
async function reopenMoveIn(tenantId, userId, leaseId, reason) {
  await loadLease(pool, tenantId, leaseId, null);
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
    { by: userId, reason: reason, leaseId, snapshot: JSON.stringify(snapshot) },
  );
  await deleteInspectionFile(report.tenant_signature_path);
  await deleteInspectionFile(report.agent_signature_path);
  const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  return row;
}

/** Données du PDF (fiche finalisée uniquement). */
async function getMoveInPdfData(tenantId, leaseId, scopeAgentId) {
  const lease = await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const row = await loadInspectionReportRow(pool, 'move_in_reports', leaseId);
  if (!row) throw new ApiError(404, "Aucun état des lieux d'entrée pour ce bail");
  if (row.status !== 'finalized') {
    throw new ApiError(400, 'Cette fiche doit être finalisée (signée) avant de générer le PDF.');
  }

  const [renterRows] = await pool.query('SELECT * FROM renters WHERE id = :id LIMIT 1', { id: lease.renter_id });
  const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });
  // Code de vérification (étape 29) — récupéré, jamais un téléchargement
  // compté ici : côté personnel, les téléchargements restent illimités par
  // conception (seul le portail public plafonne).
  const issuance = await getOrCreateIssuance(tenantId, 'etat_lieux_entree', leaseId);
  return { lease, row, renter: renterRows[0], tenant: tenantRows[0], issuance };
}

module.exports = {
  getMoveInReport,
  startMoveInReport,
  updateMoveInDraft,
  addMoveInPhoto,
  deleteMoveInPhoto,
  finalizeMoveIn,
  reopenMoveIn,
  getMoveInPdfData,
};
