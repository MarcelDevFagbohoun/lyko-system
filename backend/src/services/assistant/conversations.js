'use strict';

const { pool } = require('../../config/db');

/**
 * Conversations de l'assistant : PRIVÉES à leur auteur. Toute lecture/suppression exige à la fois
 * l'entreprise ET l'utilisateur — un employé ne voit jamais la conversation d'un autre, pas même celle
 * de la direction.
 */

const isoDate = (d) => (d instanceof Date ? d.toISOString() : d);

function makeTitle(text) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

async function listConversations(tenantId, userId, limit = 30) {
  const [rows] = await pool.query(
    `SELECT id, title, created_at, updated_at FROM assistant_conversations
     WHERE tenant_id = :tenantId AND user_id = :userId
     ORDER BY updated_at DESC, id DESC LIMIT ${Number(limit)}`,
    { tenantId, userId },
  );
  return rows.map((r) => ({ id: Number(r.id), title: r.title, createdAt: isoDate(r.created_at), updatedAt: isoDate(r.updated_at) }));
}

/** Conversation + messages, ou null si elle n'existe pas / n'appartient pas à cet utilisateur. */
async function getConversation(tenantId, userId, conversationId, db = pool) {
  const [[conv]] = await db.query(
    'SELECT id, title, created_at, updated_at FROM assistant_conversations WHERE id = :id AND tenant_id = :tenantId AND user_id = :userId LIMIT 1',
    { id: conversationId, tenantId, userId },
  );
  if (!conv) return null;
  const [messages] = await db.query(
    'SELECT id, role, content, created_at FROM assistant_messages WHERE conversation_id = :id ORDER BY id ASC LIMIT 400',
    { id: conversationId },
  );
  return {
    id: Number(conv.id),
    title: conv.title,
    createdAt: isoDate(conv.created_at),
    updatedAt: isoDate(conv.updated_at),
    messages: messages.map((m) => ({ id: Number(m.id), role: m.role, content: m.content, createdAt: isoDate(m.created_at) })),
  };
}

/** Derniers `limit` messages (du plus ancien au plus récent), propriété vérifiée. null si conversation inconnue. */
async function recentMessages(tenantId, userId, conversationId, limit) {
  const [[conv]] = await pool.query(
    'SELECT id FROM assistant_conversations WHERE id = :id AND tenant_id = :tenantId AND user_id = :userId LIMIT 1',
    { id: conversationId, tenantId, userId },
  );
  if (!conv) return null;
  const [rows] = await pool.query(
    `SELECT role, content FROM assistant_messages WHERE conversation_id = :id ORDER BY id DESC LIMIT ${Number(limit)}`,
    { id: conversationId },
  );
  const ordered = rows.reverse().map((r) => ({ role: r.role, content: r.content }));
  // L'API exige que la conversation commence par un message utilisateur : si la coupe tombe sur une réponse, on l'écarte.
  while (ordered.length > 0 && ordered[0].role !== 'user') ordered.shift();
  return ordered;
}

/** Enregistre l'échange (question + réponse) ; crée la conversation au besoin. Une transaction : tout ou rien. */
async function appendExchange({ tenantId, userId, conversationId, userText, assistantText }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let id = conversationId;
    if (!id) {
      const [r] = await conn.query(
        'INSERT INTO assistant_conversations (tenant_id, user_id, title) VALUES (:tenantId, :userId, :title)',
        { tenantId, userId, title: makeTitle(userText) },
      );
      id = r.insertId;
    } else {
      await conn.query('UPDATE assistant_conversations SET updated_at = NOW() WHERE id = :id', { id });
    }
    await conn.query(
      "INSERT INTO assistant_messages (conversation_id, tenant_id, role, content) VALUES (:id, :tenantId, 'user', :text), (:id, :tenantId, 'assistant', :reply)",
      { id, tenantId, text: userText, reply: assistantText },
    );
    await conn.commit();
    return Number(id);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteConversation(tenantId, userId, conversationId) {
  const [r] = await pool.query(
    'DELETE FROM assistant_conversations WHERE id = :id AND tenant_id = :tenantId AND user_id = :userId',
    { id: conversationId, tenantId, userId },
  );
  return r.affectedRows > 0;
}

/** Purge opportuniste des conversations plus vieilles que le délai de conservation (pas de tâche planifiée dédiée). */
async function purgeExpired(tenantId, retentionDays) {
  await pool.query(
    'DELETE FROM assistant_conversations WHERE tenant_id = :tenantId AND updated_at < (NOW() - INTERVAL :days DAY)',
    { tenantId, days: Number(retentionDays) },
  );
}

module.exports = { listConversations, getConversation, recentMessages, appendExchange, deleteConversation, purgeExpired, makeTitle };
