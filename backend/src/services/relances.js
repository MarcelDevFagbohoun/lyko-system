'use strict';

/**
 * Historique des relances (demande utilisateur, 2026-10-28) : chaque clic sur « Relancer », dans le
 * Centre de relance comme sur la fiche d'un locataire, enregistre sa date et son auteur ; un retour
 * (ce que le locataire a répondu, ce qui a été convenu) peut être ajouté après coup, par n'importe qui
 * ayant accès au dossier — pas seulement l'auteur de l'envoi.
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { assertLeaseInScope } = require('./scope');
const { toActor } = require('../utils/actor');

const SELECT = `
  rl.id, rl.entity_type, rl.entity_id, rl.sent_at, rl.outcome_note, rl.outcome_recorded_at,
  su.first_name AS sent_by_first_name, su.last_name AS sent_by_last_name, su.role AS sent_by_role,
  ou.first_name AS outcome_by_first_name, ou.last_name AS outcome_by_last_name, ou.role AS outcome_by_role
`;
const JOINS = `
  FROM relance_log rl
  JOIN users su ON su.id = rl.sent_by
  LEFT JOIN users ou ON ou.id = rl.outcome_recorded_by
`;

function toPublicRelance(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    sentAt: row.sent_at instanceof Date ? row.sent_at.toISOString().slice(0, 10) : String(row.sent_at).slice(0, 10),
    sentBy: toActor(row.sent_by_first_name, row.sent_by_last_name, row.sent_by_role),
    outcomeNote: row.outcome_note,
    outcomeRecordedAt: row.outcome_recorded_at,
    outcomeRecordedBy: toActor(row.outcome_by_first_name, row.outcome_by_last_name, row.outcome_by_role),
  };
}

/** Vérifie qu'une facture de charge appartient à l'entreprise courante et à la portée de l'agent, ou lève 404. */
async function assertChargeInScope(tenantId, chargeId, scopeAgentId) {
  const [rows] = await pool.query(
    `SELECT p.agent_id AS property_agent_id
     FROM utility_charges uc
     JOIN leases l ON l.id = uc.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE uc.id = :id AND uc.tenant_id = :tenantId AND uc.deleted_at IS NULL LIMIT 1`,
    { id: chargeId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Facture introuvable');
  if (scopeAgentId != null && Number(rows[0].property_agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Facture introuvable');
  }
}

async function assertEntityInScope(tenantId, entityType, entityId, scopeAgentId) {
  if (entityType === 'bail') {
    await assertLeaseInScope(tenantId, entityId, scopeAgentId);
  } else {
    await assertChargeInScope(tenantId, entityId, scopeAgentId);
  }
}

/** Enregistre une relance envoyée (date du jour, auteur) — appelé au clic sur « Relancer ». */
async function recordRelance(tenantId, userId, scopeAgentId, { entityType, entityId }) {
  await assertEntityInScope(tenantId, entityType, entityId, scopeAgentId);
  const [result] = await pool.query(
    'INSERT INTO relance_log (tenant_id, entity_type, entity_id, sent_at, sent_by) VALUES (:tenantId, :entityType, :entityId, CURDATE(), :by)',
    { tenantId, entityType, entityId, by: userId },
  );
  const [rows] = await pool.query(`SELECT ${SELECT} ${JOINS} WHERE rl.id = :id`, { id: result.insertId });
  return toPublicRelance(rows[0]);
}

/** Historique des relances d'UN dossier précis (bail ou facture), la plus récente d'abord. */
async function listRelances(tenantId, entityType, entityId, scopeAgentId) {
  await assertEntityInScope(tenantId, entityType, entityId, scopeAgentId);
  const [rows] = await pool.query(
    `SELECT ${SELECT} ${JOINS}
     WHERE rl.tenant_id = :tenantId AND rl.entity_type = :entityType AND rl.entity_id = :entityId
     ORDER BY rl.sent_at DESC, rl.id DESC`,
    { tenantId, entityType, entityId },
  );
  return rows.map(toPublicRelance);
}

/**
 * Historique COMPLET d'un bail, pour sa fiche locataire : relances de loyer ET relances des charges
 * SONEB/SBEE rattachées à ce bail, dans un seul fil — le locataire ne distingue pas qui l'a relancé
 * pour quoi, il voit toutes les relances reçues.
 */
async function listRelancesForLease(tenantId, leaseId, scopeAgentId) {
  await assertLeaseInScope(tenantId, leaseId, scopeAgentId);
  const [rows] = await pool.query(
    `SELECT ${SELECT} ${JOINS}
     WHERE rl.tenant_id = :tenantId AND (
       (rl.entity_type = 'bail' AND rl.entity_id = :leaseId)
       OR (rl.entity_type = 'charge' AND rl.entity_id IN (SELECT id FROM utility_charges WHERE lease_id = :leaseId))
     )
     ORDER BY rl.sent_at DESC, rl.id DESC`,
    { tenantId, leaseId },
  );
  return rows.map(toPublicRelance);
}

/** Ajoute ou corrige le retour (réponse du locataire, suite donnée) d'une relance déjà envoyée. */
async function setOutcome(tenantId, userId, scopeAgentId, relanceId, note) {
  const [existing] = await pool.query(
    'SELECT entity_type, entity_id FROM relance_log WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
    { id: relanceId, tenantId },
  );
  if (!existing[0]) throw new ApiError(404, 'Relance introuvable');
  await assertEntityInScope(tenantId, existing[0].entity_type, existing[0].entity_id, scopeAgentId);

  await pool.query(
    'UPDATE relance_log SET outcome_note = :note, outcome_recorded_at = NOW(), outcome_recorded_by = :by WHERE id = :id',
    { note, by: userId, id: relanceId },
  );
  const [rows] = await pool.query(`SELECT ${SELECT} ${JOINS} WHERE rl.id = :id`, { id: relanceId });
  return toPublicRelance(rows[0]);
}

module.exports = { recordRelance, listRelances, listRelancesForLease, setOutcome };
