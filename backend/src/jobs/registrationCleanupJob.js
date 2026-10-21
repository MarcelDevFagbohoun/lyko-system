'use strict';

/**
 * Inscriptions abandonnées (demande utilisateur, 2026-10-18) : un DG qui ne saisit jamais le
 * code reçu par email voit son entreprise supprimée après 24h — le téléphone/RCCM/IFU utilisés
 * redeviennent disponibles pour une nouvelle inscription, plutôt que de rester bloqués
 * indéfiniment par un compte jamais activé. `DELETE FROM tenants` suffit : `fk_users_tenant`
 * est `ON DELETE CASCADE` (vérifié en base), et une entreprise jamais vérifiée n'a par
 * construction aucune autre donnée (aucune connexion possible avant la vérification).
 */

const { pool } = require('../config/db');
const logger = require('../utils/logger');

const ABANDONED_AFTER_HOURS = 24;

// `tenantIds` : uniquement pour les tests (cibler des cabinets jetables) — le planificateur
// l'appelle sans argument : toutes les inscriptions abandonnées, tous cabinets confondus.
async function runRegistrationCleanupJob({ tenantIds = null } = {}) {
  const params = { hours: ABANDONED_AFTER_HOURS };
  let where = "u.role = 'dg' AND u.email_verified_at IS NULL AND u.created_at < DATE_SUB(NOW(), INTERVAL :hours HOUR)";
  if (tenantIds) {
    where += ' AND u.tenant_id IN (:tenantIds)';
    params.tenantIds = tenantIds;
  }

  const [rows] = await pool.query(`SELECT DISTINCT u.tenant_id FROM users u WHERE ${where}`, params);

  for (const { tenant_id: tenantId } of rows) {
    try {
      await pool.query('DELETE FROM tenants WHERE id = :id', { id: tenantId });
      logger.info('Inscription abandonnée supprimée (jamais vérifiée après 24h)', { tenantId });
    } catch (err) {
      logger.error("Échec de la suppression d'une inscription abandonnée", { tenantId, error: err.message });
    }
  }
}

module.exports = { runRegistrationCleanupJob };
