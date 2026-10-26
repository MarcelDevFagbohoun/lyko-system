'use strict';

/**
 * Actions sur le contrat de bail (lecture, brouillon, conditions particulières, finalisation, données PDF).
 * Les routes gardent la validation, les logs et la mise en forme publique (`toPublicContract`) ; ce module
 * porte le SQL et les règles métier. Les services renvoient la ligne brute (`row`) + l'aperçu.
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { loadLease } = require('./rentPayments');
const { buildContractData, loadContractRow } = require('./leaseContract');

function assertDraft(report, label) {
  if (!report) throw new ApiError(404, `Aucun ${label} pour ce bail`);
  if (report.status !== 'draft') {
    throw new ApiError(409, `Cette fiche est déjà finalisée et ne peut plus être modifiée.`);
  }
}

/** Contrat (ligne brute, ou null) + aperçu LIVE des données du bail. */
async function getContract(tenantId, leaseId, scopeAgentId) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const row = await loadContractRow(tenantId, leaseId);
  const preview = await buildContractData(tenantId, leaseId, {
    particularConditions: row?.particular_conditions ?? null,
  });
  return { row, preview };
}

/** Démarre le brouillon du contrat (une fois par bail). */
async function startContract(tenantId, userId, leaseId, scopeAgentId) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);

  const [existing] = await pool.query('SELECT id FROM lease_contracts WHERE lease_id = :leaseId LIMIT 1', {
    leaseId,
  });
  if (existing[0]) throw new ApiError(409, 'Un contrat existe déjà pour ce bail');

  await pool.query(
    `INSERT INTO lease_contracts (tenant_id, lease_id, status, created_by) VALUES (:tenantId, :leaseId, 'draft', :by)`,
    { tenantId, leaseId, by: userId },
  );

  const row = await loadContractRow(tenantId, leaseId);
  const preview = await buildContractData(tenantId, leaseId, { particularConditions: null });
  return { row, preview };
}

/** Enregistre les conditions particulières (refusé une fois le contrat finalisé). */
async function updateContractConditions(tenantId, leaseId, scopeAgentId, particularConditions) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const contract = await loadContractRow(tenantId, leaseId);
  assertDraft(contract, 'contrat de bail');

  await pool.query('UPDATE lease_contracts SET particular_conditions = :text WHERE lease_id = :leaseId', {
    text: particularConditions,
    leaseId,
  });

  const row = await loadContractRow(tenantId, leaseId);
  const preview = await buildContractData(tenantId, leaseId, {
    particularConditions: row.particular_conditions,
  });
  return { row, preview };
}

/**
 * Verrouille le contrat et fige les données du bail dans `snapshot`.
 * `saveSignature(kind)` enregistre le fichier de signature ('tenant' | 'agent') et renvoie son chemin
 * relatif ; il n'est appelé qu'après les vérifications (brouillon), comme avant.
 */
async function finalizeContract(tenantId, userId, leaseId, scopeAgentId, saveSignature) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const contract = await loadContractRow(tenantId, leaseId);
  assertDraft(contract, 'contrat de bail');

  const snapshot = await buildContractData(tenantId, leaseId, {
    particularConditions: contract.particular_conditions,
  });

  const tenantSignaturePath = await saveSignature('tenant');
  const agentSignaturePath = await saveSignature('agent');

  await pool.query(
    `UPDATE lease_contracts
     SET status = 'finalized', finalized_at = NOW(), finalized_by = :by,
         tenant_signature_path = :tenantSig, agent_signature_path = :agentSig, snapshot = :snapshot
     WHERE lease_id = :leaseId`,
    {
      by: userId,
      tenantSig: tenantSignaturePath,
      agentSig: agentSignaturePath,
      snapshot: JSON.stringify(snapshot),
      leaseId,
    },
  );

  const row = await loadContractRow(tenantId, leaseId);
  return { row, snapshot };
}

/** Données du PDF : brouillon (aperçu LIVE) ou contrat finalisé (données figées). */
async function getContractPdfData(tenantId, leaseId, scopeAgentId) {
  const lease = await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const contract = await loadContractRow(tenantId, leaseId);
  if (!contract) throw new ApiError(404, 'Aucun contrat pour ce bail');

  const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });
  const [[dg]] = await pool.query(
    "SELECT first_name, last_name, role, stamp_path, signature_path FROM users WHERE tenant_id = :tenantId AND role = 'dg' LIMIT 1",
    { tenantId },
  );

  // `snapshot` est une colonne JSON — le pilote mysql2 la relit déjà comme un objet JS natif, jamais
  // une chaîne à parser (contrairement à un champ TEXT contenant du JSON) : `JSON.parse` planterait ici
  // ("[object Object]" n'est pas un JSON valide).
  const data =
    contract.status === 'finalized'
      ? contract.snapshot
      : await buildContractData(tenantId, leaseId, { particularConditions: contract.particular_conditions });

  return { lease, contract, tenant, dg, data };
}

module.exports = { getContract, startContract, updateContractConditions, finalizeContract, getContractPdfData };
