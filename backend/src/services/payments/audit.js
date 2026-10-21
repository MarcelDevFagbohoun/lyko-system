'use strict';

const crypto = require('crypto');
const { pool } = require('../../config/db');

/**
 * Journal d'audit des paiements, en ajout seul et chaîné par hachage : chaque ligne contient le hachage de la
 * précédente du même cabinet. Modifier ou supprimer une ligne passée casse la chaîne, détectable par
 * `verifyAuditChain`. Les détails sont filtrés : aucune clé contenant password/secret/token/key n'est jamais écrite.
 */
const GENESIS = '0'.repeat(64);
const FORBIDDEN_KEY = /pass|secret|token|key|authorization|cvv|pin/i;

function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') return null;
  const clean = {};
  for (const [k, v] of Object.entries(details)) {
    if (FORBIDDEN_KEY.test(k)) continue;
    clean[k] = typeof v === 'string' ? v.slice(0, 300) : v;
  }
  return JSON.stringify(clean);
}

function computeHash({ prevHash, tenantId, orderId, eventType, actorUserId, createdAtIso, details }) {
  return crypto
    .createHash('sha256')
    .update([prevHash, tenantId, orderId ?? '', eventType, actorUserId ?? '', createdAtIso, details ?? ''].join('|'))
    .digest('hex');
}

/** Ajoute un évènement. Sa propre connexion/transaction : la chaîne d'un cabinet est sérialisée par un verrou sur sa ligne. */
async function appendAudit({ tenantId, orderId = null, eventType, actorUserId = null, req = null, details = null }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM tenants WHERE id = :tenantId FOR UPDATE', { tenantId });
    const [[last]] = await conn.query(
      'SELECT hash FROM payment_audit_events WHERE tenant_id = :tenantId ORDER BY id DESC LIMIT 1',
      { tenantId },
    );
    const prevHash = last ? last.hash : GENESIS;
    const createdAt = new Date();
    const detailsJson = sanitizeDetails(details);
    const hash = computeHash({ prevHash, tenantId, orderId, eventType, actorUserId, createdAtIso: createdAt.toISOString(), details: detailsJson });
    await conn.query(
      `INSERT INTO payment_audit_events (tenant_id, order_id, event_type, actor_user_id, ip, user_agent, details, prev_hash, hash, created_at)
       VALUES (:tenantId, :orderId, :eventType, :actorUserId, :ip, :ua, :details, :prevHash, :hash, :createdAt)`,
      {
        tenantId,
        orderId,
        eventType,
        actorUserId,
        ip: req?.ip ? String(req.ip).slice(0, 45) : null,
        ua: req?.get ? String(req.get('user-agent') ?? '').slice(0, 200) || null : null,
        details: detailsJson,
        prevHash,
        hash,
        createdAt,
      },
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Recalcule toute la chaîne d'un cabinet. `{ ok: true, count }` ou `{ ok: false, brokenAtId }`. */
async function verifyAuditChain(tenantId) {
  const [rows] = await pool.query(
    `SELECT id, order_id, event_type, actor_user_id, details, prev_hash, hash, created_at
     FROM payment_audit_events WHERE tenant_id = :tenantId ORDER BY id ASC`,
    { tenantId },
  );
  let prev = GENESIS;
  for (const r of rows) {
    const expected = computeHash({
      prevHash: prev,
      tenantId,
      orderId: r.order_id,
      eventType: r.event_type,
      actorUserId: r.actor_user_id,
      createdAtIso: new Date(r.created_at).toISOString(),
      details: r.details,
    });
    if (r.prev_hash !== prev || r.hash !== expected) return { ok: false, brokenAtId: r.id, count: rows.length };
    prev = r.hash;
  }
  return { ok: true, count: rows.length };
}

module.exports = { appendAudit, verifyAuditChain, sanitizeDetails };
