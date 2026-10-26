'use strict';

/**
 * Fiche de notes d'un locataire ou d'un propriétaire : un seul document de texte riche (Markdown restreint,
 * rendu côté site par un lecteur qui n'accepte ni HTML ni image ni lien externe).
 * Détection des modifications simultanées : l'enregistrement porte la version lue ; si quelqu'un a enregistré
 * entre-temps, il est refusé (409) et la version courante est renvoyée pour que rien ne soit écrasé sans le savoir.
 */
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { toActor } = require('../utils/actor');

const MAX_LENGTH = 20000;

function toSheet(r) {
  if (!r) return { content: '', version: 0, updatedAt: null, updatedBy: null };
  return { content: r.content, version: r.version, updatedAt: r.updated_at, updatedBy: r.first_name ? toActor(r.first_name, r.last_name, r.role) : null };
}

async function getSheet(tenantId, entityType, entityId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT s.content, s.version, s.updated_at, u.first_name, u.last_name, u.role
     FROM note_sheets s LEFT JOIN users u ON u.id = s.updated_by
     WHERE s.tenant_id = :tenantId AND s.entity_type = :entityType AND s.entity_id = :entityId`,
    { tenantId, entityType, entityId },
  );
  return toSheet(rows[0]);
}

/** @returns {Promise<object>} la fiche enregistrée. Lève 409 {sheet} si elle a changé depuis la version lue. */
async function saveSheet({ tenantId, userId, entityType, entityId, content, version }) {
  const text = String(content ?? '').replace(/\r\n/g, '\n').trimEnd();
  if (text.length > MAX_LENGTH) throw new ApiError(400, `La fiche est trop longue (${MAX_LENGTH} caractères au maximum).`);
  const conflict = async () => {
    const err = new ApiError(409, 'La fiche a été modifiée par quelqu’un d’autre pendant que vous écriviez. Rechargez-la pour ne rien perdre.');
    err.details = { sheet: await getSheet(tenantId, entityType, entityId) };
    return err;
  };
  if (version === 0) {
    try {
      await pool.query(
        'INSERT INTO note_sheets (tenant_id, entity_type, entity_id, content, version, updated_by) VALUES (:tenantId, :entityType, :entityId, :text, 1, :userId)',
        { tenantId, entityType, entityId, text, userId },
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw await conflict();
      throw err;
    }
  } else {
    const [r] = await pool.query(
      `UPDATE note_sheets SET content = :text, version = version + 1, updated_by = :userId
       WHERE tenant_id = :tenantId AND entity_type = :entityType AND entity_id = :entityId AND version = :version`,
      { text, userId, tenantId, entityType, entityId, version },
    );
    if (r.affectedRows === 0) throw await conflict();
  }
  return getSheet(tenantId, entityType, entityId);
}

module.exports = { getSheet, saveSheet, MAX_LENGTH };
