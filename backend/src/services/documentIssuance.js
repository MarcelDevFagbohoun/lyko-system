'use strict';

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { generateVerificationCode } = require('../utils/tokens');

/**
 * Suivi des téléchargements de quittance/attestation/relevé propriétaire
 * (étape 29) : limite de 5 téléchargements par document, et un code de
 * vérification publique imprimé sur le PDF pour qu'un tiers (banque, autre
 * bailleur...) puisse confirmer son authenticité sans avoir accès à
 * l'espace connecté.
 *
 * Une ligne par document (jamais par token de portail — régénérer un lien
 * ne doit pas remettre le compteur à zéro).
 */

/** Charge la ligne existante, ou en crée une (avec un nouveau code) si c'est le premier téléchargement. */
async function getOrCreateIssuance(tenantId, documentType, referenceId) {
  const [existing] = await pool.query(
    'SELECT * FROM document_issuances WHERE tenant_id = :tenantId AND document_type = :documentType AND reference_id = :referenceId LIMIT 1',
    { tenantId, documentType, referenceId },
  );
  if (existing[0]) return existing[0];

  const code = generateVerificationCode();
  try {
    const [result] = await pool.query(
      `INSERT INTO document_issuances (tenant_id, document_type, reference_id, verification_code)
       VALUES (:tenantId, :documentType, :referenceId, :code)`,
      { tenantId, documentType, referenceId, code },
    );
    return {
      id: result.insertId,
      tenant_id: tenantId,
      document_type: documentType,
      reference_id: referenceId,
      verification_code: code,
      download_count: 0,
      max_downloads: 5,
    };
  } catch (err) {
    // Course entre deux premiers téléchargements simultanés du même document
    // (deux onglets, double-clic) — l'un des deux perd la contrainte unique,
    // relit simplement la ligne que l'autre vient de créer.
    if (err.code === 'ER_DUP_ENTRY') {
      const [retry] = await pool.query(
        'SELECT * FROM document_issuances WHERE tenant_id = :tenantId AND document_type = :documentType AND reference_id = :referenceId LIMIT 1',
        { tenantId, documentType, referenceId },
      );
      if (retry[0]) return retry[0];
    }
    throw err;
  }
}

/**
 * Incrémente le compteur si la limite n'est pas atteinte, atomiquement
 * (la clause `download_count < max_downloads` dans le WHERE évite tout
 * verrou explicite — deux requêtes concurrentes ne peuvent pas dépasser la
 * limite ensemble). Lève une 403 explicite sinon.
 */
async function registerDownload(issuance) {
  const [result] = await pool.query(
    `UPDATE document_issuances
     SET download_count = download_count + 1,
         last_downloaded_at = NOW(),
         first_downloaded_at = COALESCE(first_downloaded_at, NOW())
     WHERE id = :id AND download_count < max_downloads`,
    { id: issuance.id },
  );
  if (result.affectedRows === 0) {
    throw new ApiError(
      403,
      `Ce document a déjà été téléchargé ${issuance.max_downloads} fois, la limite autorisée. Contactez votre agence pour le recevoir à nouveau.`,
    );
  }
}

/** Remet le compteur à zéro (DG uniquement, depuis la fiche du locataire/propriétaire). */
async function resetIssuance(tenantId, documentType, referenceId, resetByUserId) {
  const [result] = await pool.query(
    `UPDATE document_issuances
     SET download_count = 0, reset_count = reset_count + 1, last_reset_by = :resetByUserId, last_reset_at = NOW()
     WHERE tenant_id = :tenantId AND document_type = :documentType AND reference_id = :referenceId`,
    { tenantId, documentType, referenceId, resetByUserId },
  );
  return result.affectedRows > 0;
}

/** État actuel (pour l'affichage employé) — jamais créé ici, seulement lu (null si jamais téléchargé). */
async function getIssuanceStatus(tenantId, documentType, referenceId) {
  const [rows] = await pool.query(
    'SELECT download_count, max_downloads, last_downloaded_at FROM document_issuances WHERE tenant_id = :tenantId AND document_type = :documentType AND reference_id = :referenceId LIMIT 1',
    { tenantId, documentType, referenceId },
  );
  return rows[0] || null;
}

/**
 * Vérification publique par code (page /verifier, sans authentification) —
 * ne renvoie jamais de montant ni de donnée personnelle au-delà du strict
 * nécessaire pour confirmer l'authenticité.
 */
async function findByVerificationCode(code) {
  const [rows] = await pool.query(
    `SELECT di.document_type, di.created_at, t.company_name
     FROM document_issuances di
     JOIN tenants t ON t.id = di.tenant_id
     WHERE di.verification_code = :code LIMIT 1`,
    { code },
  );
  return rows[0] || null;
}

module.exports = { getOrCreateIssuance, registerDownload, resetIssuance, getIssuanceStatus, findByVerificationCode };
