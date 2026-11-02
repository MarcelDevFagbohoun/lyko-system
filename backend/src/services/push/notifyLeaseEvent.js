'use strict';

/**
 * Résolution des destinataires d'un événement métier lié à un bien/bail
 * (paiement reçu, plainte, relance) pour les notifications push : le DG de
 * l'entreprise (toujours) et, s'il existe, l'agent assigné à ce bien
 * (`properties.agent_id`, migration 023 — même notion que la portée agent de
 * `services/scope.js`). Centralisé ici pour être réutilisé par les
 * paiements, les plaintes et les relances sans dupliquer la requête DG.
 */

const { pool } = require('../../config/db');
const { sendPushToUser } = require('./sendPush');
const logger = require('../../utils/logger');

/** Notifie en push le DG et l'agent assigné (si distinct), sans jamais lever d'exception. */
async function notifyLeaseStaff(tenantId, propertyAgentId, payload) {
  try {
    const [dgRows] = await pool.query(
      "SELECT id FROM users WHERE tenant_id = :tenantId AND role = 'dg' LIMIT 1",
      { tenantId },
    );
    const recipients = new Set();
    if (dgRows[0]) recipients.add(Number(dgRows[0].id));
    if (propertyAgentId) recipients.add(Number(propertyAgentId));
    await Promise.all([...recipients].map((userId) => sendPushToUser(userId, payload)));
  } catch (err) {
    logger.warn('Échec de résolution des destinataires push (bail/bien)', { tenantId, error: err.message });
  }
}

/** Variante pratique quand seul l'id du bail est disponible (agent du bien pas déjà chargé). */
async function notifyLeaseStaffByLeaseId(tenantId, leaseId, payload) {
  try {
    const [rows] = await pool.query(
      `SELECT p.agent_id AS property_agent_id
       FROM leases l JOIN property_units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id
       WHERE l.id = :leaseId AND l.tenant_id = :tenantId LIMIT 1`,
      { leaseId, tenantId },
    );
    await notifyLeaseStaff(tenantId, rows[0]?.property_agent_id ?? null, payload);
  } catch (err) {
    logger.warn("Échec de résolution de l'agent du bail pour le push", { tenantId, leaseId, error: err.message });
  }
}

module.exports = { notifyLeaseStaff, notifyLeaseStaffByLeaseId };
