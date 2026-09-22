'use strict';

/** Notifie le DG d'une action comptable sensible — voir migration 041. */
async function notifyDg(conn, { tenantId, type, message, entityTable, entityId }) {
  const [dgRows] = await conn.query("SELECT id FROM users WHERE tenant_id = :tenantId AND role = 'dg' LIMIT 1", {
    tenantId,
  });
  if (!dgRows[0]) return; // ne devrait jamais arriver (toujours exactement un DG par tenant)
  await conn.query(
    `INSERT INTO gl_notifications (tenant_id, user_id, type, message, entity_table, entity_id)
     VALUES (:tenantId, :userId, :type, :message, :entityTable, :entityId)`,
    { tenantId, userId: dgRows[0].id, type, message, entityTable: entityTable ?? null, entityId: entityId ?? null },
  );
}

module.exports = { notifyDg };
