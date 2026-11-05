'use strict';

/**
 * Actions sur le contrat de bail (lecture, brouillon, conditions particulières, finalisation, données PDF).
 * Les routes gardent la validation, les logs et la mise en forme publique (`toPublicContract`) ; ce module
 * porte le SQL et les règles métier. Les services renvoient la ligne brute (`row`) + l'aperçu.
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { loadLease } = require('./rentPayments');
const { buildContractData, loadContractRow, loadTenantContractFields } = require('./leaseContract');
const { renderContractText, DEFAULT_CONTRACT_TEMPLATE, renderContractTemplate, buildTemplatePlaceholders } = require('./leaseContractTemplate');
const { assertDraft } = require('./inspectionReports');

/** Aperçu LIVE : données du bail + texte des articles rendu avec le modèle courant de l'entreprise. */
async function buildLivePreview(tenantId, leaseId, particularConditions) {
  const [data, tenantFields] = await Promise.all([
    buildContractData(tenantId, leaseId, { particularConditions }),
    loadTenantContractFields(tenantId),
  ]);
  return { ...data, renderedText: renderContractText(tenantFields, data) };
}

/** Contrat (ligne brute, ou null) + aperçu LIVE des données du bail. */
async function getContract(tenantId, leaseId, scopeAgentId) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const row = await loadContractRow(tenantId, leaseId);
  const preview = await buildLivePreview(tenantId, leaseId, row?.particular_conditions ?? null);
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
  const preview = await buildLivePreview(tenantId, leaseId, null);
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
  const preview = await buildLivePreview(tenantId, leaseId, row.particular_conditions);
  return { row, preview };
}

/**
 * Verrouille le contrat et fige les données du bail dans `snapshot`. Plus de signatures numériques
 * (demande utilisateur, 2026-11-02) : le contrat finalisé porte OBLIGATOIREMENT le cachet du DG (voir
 * `getContractPdfData` et `services/pdf.js` `streamLeaseContractPdf`) — on refuse donc de finaliser si
 * le DG de l'entreprise n'a pas encore téléversé son cachet (Mon compte).
 */
async function finalizeContract(tenantId, userId, leaseId, scopeAgentId) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const contract = await loadContractRow(tenantId, leaseId);
  assertDraft(contract, 'contrat de bail');

  const [[dg]] = await pool.query(
    "SELECT stamp_path FROM users WHERE tenant_id = :tenantId AND role = 'dg' LIMIT 1",
    { tenantId },
  );
  if (!dg?.stamp_path) {
    throw new ApiError(
      400,
      'Le cachet du directeur général doit être téléversé (Mon compte) avant de pouvoir signer un contrat de bail.',
    );
  }

  const [data, tenantFields] = await Promise.all([
    buildContractData(tenantId, leaseId, { particularConditions: contract.particular_conditions }),
    loadTenantContractFields(tenantId),
  ]);
  // Figé pour toujours : le texte des articles au moment de la signature, jamais recalculé depuis le
  // modèle de l'entreprise après coup, même si celui-ci est modifié plus tard (voir en-tête du fichier).
  const snapshot = { ...data, renderedText: renderContractText(tenantFields, data) };

  await pool.query(
    `UPDATE lease_contracts
     SET status = 'finalized', finalized_at = NOW(), finalized_by = :by, snapshot = :snapshot
     WHERE lease_id = :leaseId`,
    { by: userId, snapshot: JSON.stringify(snapshot), leaseId },
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
    "SELECT first_name, last_name, role, stamp_path FROM users WHERE tenant_id = :tenantId AND role = 'dg' LIMIT 1",
    { tenantId },
  );

  // `snapshot` est une colonne JSON — le pilote mysql2 la relit déjà comme un objet JS natif, jamais
  // une chaîne à parser (contrairement à un champ TEXT contenant du JSON) : `JSON.parse` planterait ici
  // ("[object Object]" n'est pas un JSON valide).
  let data;
  if (contract.status === 'finalized') {
    data = contract.snapshot;
    // Contrat finalisé AVANT cette fonctionnalité : son `snapshot` n'a pas encore de `renderedText`.
    // On le reconstitue avec le modèle PAR DÉFAUT (jamais le modèle personnalisé courant, inexistant à
    // l'époque de la signature) appliqué à ses données figées — reproduit fidèlement ce qui a été
    // réellement signé, sans migration de données nécessaire.
    if (!data.renderedText) {
      data = { ...data, renderedText: renderContractTemplate(DEFAULT_CONTRACT_TEMPLATE, buildTemplatePlaceholders(data, tenant)) };
    }
  } else {
    const liveData = await buildContractData(tenantId, leaseId, { particularConditions: contract.particular_conditions });
    data = { ...liveData, renderedText: renderContractText(tenant, liveData) };
  }

  return { lease, contract, tenant, dg, data };
}

module.exports = { getContract, startContract, updateContractConditions, finalizeContract, getContractPdfData };
