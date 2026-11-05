'use strict';

/**
 * Helpers communs aux états des lieux d'entrée et de sortie : lecture de la fiche (avec les acteurs),
 * garde-fous brouillon/finalisé, et fichiers (photos) rangés sous uploads/.
 */

const path = require('path');
const fs = require('fs/promises');
const { ApiError } = require('../middleware/error');
const { assertUploadType, randomFileName } = require('../utils/uploads');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

const INSPECTION_REPORT_SELECT = `
  t.*, cu.first_name AS conductor_first_name, cu.last_name AS conductor_last_name, cu.role AS conductor_role,
  fu.first_name AS finalizer_first_name, fu.last_name AS finalizer_last_name, fu.role AS finalizer_role,
  ru.first_name AS reopener_first_name, ru.last_name AS reopener_last_name, ru.role AS reopener_role,
  al.archived_at AS lease_archived_at,
  au.first_name AS archiver_first_name, au.last_name AS archiver_last_name, au.role AS archiver_role
`;

// move_out_reports uniquement (colonnes absentes de move_in_reports) — la
// jointure reste dans une clause à part pour ne pas casser move_in_reports.
// Étendu (2026-11-03) avec les acteurs du circuit de validation/décaissement
// (soumission employé, revue DG, paiement, frais de réparation) — voir
// migration 139 et `services/moveOutReport.js`.
const MOVE_OUT_REGULARIZER_SELECT = `,
  gu.first_name AS regularizer_first_name, gu.last_name AS regularizer_last_name, gu.role AS regularizer_role,
  su.first_name AS submitter_first_name, su.last_name AS submitter_last_name, su.role AS submitter_role,
  rvu.first_name AS reviewer_first_name, rvu.last_name AS reviewer_last_name, rvu.role AS reviewer_role,
  pu.first_name AS payer_first_name, pu.last_name AS payer_last_name, pu.role AS payer_role,
  rfu.first_name AS repair_fee_user_first_name, rfu.last_name AS repair_fee_user_last_name, rfu.role AS repair_fee_user_role`;
const MOVE_OUT_REGULARIZER_JOIN = `
  LEFT JOIN users gu ON gu.id = t.gl_regularized_by
  LEFT JOIN users su ON su.id = t.submitted_by
  LEFT JOIN users rvu ON rvu.id = t.reviewed_by
  LEFT JOIN users pu ON pu.id = t.payout_paid_by
  LEFT JOIN users rfu ON rfu.id = t.repair_fee_charged_by`;

/** `reportsTable` : toujours l'un des deux littéraux ci-dessous, jamais une valeur venue du client. */
async function loadInspectionReportRow(conn, reportsTable, leaseId) {
  const isMoveOut = reportsTable === 'move_out_reports';
  const [rows] = await conn.query(
    `SELECT ${INSPECTION_REPORT_SELECT}${isMoveOut ? MOVE_OUT_REGULARIZER_SELECT : ''} FROM ${reportsTable} t
     LEFT JOIN users cu ON cu.id = t.conducted_by
     LEFT JOIN users fu ON fu.id = t.finalized_by
     LEFT JOIN users ru ON ru.id = t.reopened_by
     -- Archivage manuel du locataire (migration 140) : vit sur leases, pas sur la fiche elle-même —
     -- jointe ici pour que toPublicMoveOutReport puisse exposer si/quand/par qui, et afficher ou non
     -- le bouton « Archivé » côté frontend sans requête séparée.
     LEFT JOIN leases al ON al.id = t.lease_id
     LEFT JOIN users au ON au.id = al.archived_by
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

module.exports = {
  loadInspectionReportRow,
  assertDraft,
  assertFinalized,
  saveInspectionFile,
  deleteInspectionFile,
};
