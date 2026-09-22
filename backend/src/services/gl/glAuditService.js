'use strict';

/**
 * Journal d'audit dédié à la comptabilité (`gl_audit_log`) — plus strict que
 * le « Journal d'activité » existant (`services/activity.js`, une agrégation
 * en LECTURE depuis les tables métier) : ici, une ligne écrite explicitement
 * à chaque action sensible, avec IP et valeurs avant/après.
 */
async function logGlAudit(conn, { tenantId, userId, ipAddress, action, entityTable, entityId, before, after }) {
  await conn.query(
    `INSERT INTO gl_audit_log (tenant_id, user_id, ip_address, action, entity_table, entity_id, before_json, after_json)
     VALUES (:tenantId, :userId, :ipAddress, :action, :entityTable, :entityId, :before, :after)`,
    {
      tenantId,
      userId: userId ?? null,
      ipAddress: ipAddress ?? null,
      action,
      entityTable,
      entityId,
      before: before !== undefined ? JSON.stringify(before) : null,
      after: after !== undefined ? JSON.stringify(after) : null,
    },
  );
}

module.exports = { logGlAudit };
