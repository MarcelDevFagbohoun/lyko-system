'use strict';

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');

/**
 * Portée d'accès d'un AGENT sur le portefeuille de Biens (étape 14,
 * « ajouter un nombre donné de Biens à un agent pour la gestion »).
 *
 * Renvoie `null` quand l'accès doit rester COMPLET :
 *   - DG ou comptable (jamais concernés par cette restriction) ;
 *   - un agent auquel AUCUN Bien n'est encore attribué — décision produit
 *     explicite : ne jamais couper l'accès existant d'un agent tant que le
 *     DG n'a rien attribué (comportement historique inchangé par défaut).
 *
 * Renvoie l'id de l'agent (son propre `user.id`) quand l'accès doit être
 * RESTREINT aux seuls Biens dont `properties.agent_id` vaut cet id — un seul
 * agent par Bien (pas de table de jointure : une simple colonne suffit).
 *
 * Une requête par appel : à résoudre une fois par requête HTTP et réutiliser
 * la valeur partout où c'est pertinent dans le même handler.
 */
async function resolvePropertyScope(user) {
  if (user.role !== 'agent') return null;
  const [rows] = await pool.query(
    'SELECT 1 FROM properties WHERE tenant_id = :tenantId AND agent_id = :userId LIMIT 1',
    { tenantId: user.tenantId, userId: user.id },
  );
  return rows.length > 0 ? user.id : null;
}

/**
 * Vérifie qu'un locataire est rattaché à AU MOINS UN bail (actif ou terminé)
 * sur un Bien géré par l'agent restreint — sinon 404 (jamais 403, pas
 * d'énumération). Ne fait rien si `scopeAgentId` est `null` (accès complet).
 */
async function assertRenterInScope(tenantId, renterId, scopeAgentId) {
  if (scopeAgentId == null) return;
  const [rows] = await pool.query(
    `SELECT 1 FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.renter_id = :renterId AND l.tenant_id = :tenantId AND p.agent_id = :scopeAgentId
     LIMIT 1`,
    { renterId, tenantId, scopeAgentId },
  );
  if (rows.length === 0) throw new ApiError(404, 'Locataire introuvable');
}

/**
 * Charge un bail de l'entreprise courante, en vérifiant au passage qu'il est
 * rattaché à un Bien dans la portée de l'agent restreint (sinon 404). Renvoie
 * la ligne du bail (utile aux appelants qui en ont besoin juste après).
 */
async function assertLeaseInScope(tenantId, leaseId, scopeAgentId) {
  const [rows] = await pool.query(
    `SELECT l.*, p.agent_id AS property_agent_id
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.id = :leaseId AND l.tenant_id = :tenantId LIMIT 1`,
    { leaseId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Bail introuvable');
  if (scopeAgentId != null && Number(rows[0].property_agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Bail introuvable');
  }
  return rows[0];
}

module.exports = { resolvePropertyScope, assertRenterInScope, assertLeaseInScope };
