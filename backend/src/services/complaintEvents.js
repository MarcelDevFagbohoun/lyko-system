'use strict';

// Suivi d'une plainte : journal daté (signalement, changements de statut, commentaires) et lien de suivi du locataire.
// Règle centrale : la visibilité est décidée ICI, côté serveur. Un événement « internal » n'est jamais renvoyé au
// locataire (page de suivi, portail) ; l'équipe voit tout. Le service possède le SQL et les transactions.

const crypto = require('crypto');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { COMPLAINT_STATUSES } = require('../constants/complaints');
const { ROLE_LABELS } = require('../constants/roles');
const { toActor } = require('../utils/actor');
const { todayIso } = require('../utils/dates');

const MAX_TENANT_COMMENTS_PER_HOUR = 10;
const TEAM_LABEL = 'Équipe de gestion';

function iso(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

async function recordEvent(conn, e) {
  const [result] = await conn.query(
    `INSERT INTO complaint_events
       (tenant_id, complaint_id, event_type, from_status, to_status, body, visibility, author_user_id, author_renter_id)
     VALUES (:tenantId, :complaintId, :type, :fromStatus, :toStatus, :body, :visibility, :userId, :renterId)`,
    {
      tenantId: e.tenantId,
      complaintId: e.complaintId,
      type: e.type,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      body: e.body ?? null,
      visibility: e.visibility ?? 'internal',
      userId: e.userId ?? null,
      renterId: e.renterId ?? null,
    },
  );
  return result.insertId;
}

/** Enregistre le signalement initial (visible du locataire). À appeler dans la transaction de création. */
async function recordReported(conn, { tenantId, complaintId, userId = null, renterId = null }) {
  return recordEvent(conn, {
    tenantId, complaintId, type: 'reported', toStatus: 'ouverte', visibility: 'tenant', userId, renterId,
  });
}

/** Jeton du lien de suivi de la plainte (créé à la demande, stable ensuite : un lien déjà donné reste valable). */
async function ensureTrackingToken(conn, complaintId) {
  const [[row]] = await conn.query('SELECT tracking_token FROM complaints WHERE id = :id', { id: complaintId });
  if (!row) throw new ApiError(404, 'Plainte introuvable');
  if (row.tracking_token) return row.tracking_token;
  const token = crypto.randomBytes(24).toString('base64url');
  // « IS NULL » : si deux requêtes se croisent, une seule écrit, l'autre relit le jeton gagnant.
  await conn.query('UPDATE complaints SET tracking_token = :token, updated_at = updated_at WHERE id = :id AND tracking_token IS NULL', {
    token, id: complaintId,
  });
  const [[after]] = await conn.query('SELECT tracking_token FROM complaints WHERE id = :id', { id: complaintId });
  return after.tracking_token;
}

function toStaffEvent(row, roleLabels) {
  return {
    id: row.id,
    type: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    body: row.body,
    visibility: row.visibility,
    isEstimated: !!row.is_estimated,
    createdAt: iso(row.created_at),
    author: row.author_renter_id
      ? { name: [row.renter_first_name, row.renter_last_name].filter(Boolean).join(' ') || 'Locataire', role: 'locataire', roleLabel: 'Locataire' }
      : toActor(row.user_first_name, row.user_last_name, row.user_role, roleLabels),
  };
}

function toTenantEvent(row) {
  const byTenant = !!row.author_renter_id;
  return {
    id: row.id,
    type: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    body: row.body,
    isEstimated: !!row.is_estimated,
    createdAt: iso(row.created_at),
    // Jamais le nom d'un employé côté locataire.
    by: byTenant ? 'tenant' : 'team',
  };
}

/** Journal pour l'équipe (tout) ou pour le locataire (visibility = 'tenant' seulement). */
async function listEvents(tenantId, complaintId, audience, roleLabels = ROLE_LABELS) {
  const staff = audience === 'staff';
  const [rows] = await pool.query(
    `SELECT e.*, u.first_name AS user_first_name, u.last_name AS user_last_name, u.role AS user_role,
            r.first_name AS renter_first_name, r.last_name AS renter_last_name
     FROM complaint_events e
     LEFT JOIN users u ON u.id = e.author_user_id
     LEFT JOIN renters r ON r.id = e.author_renter_id
     WHERE e.tenant_id = :tenantId AND e.complaint_id = :complaintId ${staff ? '' : "AND e.visibility = 'tenant'"}
     ORDER BY e.created_at ASC, e.id ASC`,
    { tenantId, complaintId },
  );
  return rows.map((row) => (staff ? toStaffEvent(row, roleLabels) : toTenantEvent(row)));
}

/** Dates clés du dossier : signalement, dernière activité, résolution. */
function summarizeDates(complaintRow, events) {
  const last = events.length ? events[events.length - 1].createdAt : null;
  return {
    reportedAt: iso(complaintRow.created_at),
    lastActivityAt: last || iso(complaintRow.updated_at),
    resolvedAt: complaintRow.resolved_at ? new Date(complaintRow.resolved_at).toISOString().slice(0, 10) : null,
  };
}

/**
 * Mise à jour par l'équipe : changement de statut et/ou commentaire, en une transaction.
 * `visibility` ne concerne que le commentaire ; un changement de statut est toujours visible du locataire.
 * La note de résolution reste interne (comportement historique : elle n'a jamais été montrée au locataire).
 */
async function applyStaffUpdate({ tenantId, complaintId, user, status, comment, visibility, resolutionNote }) {
  if (status !== undefined && !COMPLAINT_STATUSES.includes(status)) throw new ApiError(400, 'Statut invalide');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[current]] = await conn.query(
      'SELECT id, status FROM complaints WHERE id = :id AND tenant_id = :tenantId FOR UPDATE',
      { id: complaintId, tenantId },
    );
    if (!current) throw new ApiError(404, 'Plainte introuvable');

    const changed = status !== undefined && status !== current.status;
    if (changed || resolutionNote) {
      const fields = [];
      const params = { id: complaintId };
      if (changed) {
        fields.push('status = :status');
        params.status = status;
        if (status === 'resolue') {
          fields.push('resolved_at = :resolvedAt', 'resolved_by = :resolvedBy');
          params.resolvedAt = todayIso();
          params.resolvedBy = user.id;
        }
      }
      if (resolutionNote) {
        fields.push('resolution_note = :note');
        params.note = resolutionNote;
      }
      await conn.query(`UPDATE complaints SET ${fields.join(', ')} WHERE id = :id`, params);
    }
    if (changed) {
      await recordEvent(conn, {
        tenantId, complaintId, type: 'status_changed', fromStatus: current.status, toStatus: status,
        visibility: 'tenant', userId: user.id,
      });
    }
    if (resolutionNote) {
      await recordEvent(conn, { tenantId, complaintId, type: 'comment', body: resolutionNote, visibility: 'internal', userId: user.id });
    }
    if (comment) {
      await recordEvent(conn, {
        tenantId, complaintId, type: 'comment', body: comment,
        visibility: visibility === 'tenant' ? 'tenant' : 'internal', userId: user.id,
      });
    }
    await conn.commit();
    return { changed };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Plainte + bail + locataire à partir du jeton de suivi (null si inconnu). */
async function findByTrackingToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 64) return null;
  const [rows] = await pool.query(
    `SELECT c.*, l.renter_id, t.company_name, t.contact_phone, p.address AS property_address, u.code AS unit_code
     FROM complaints c
     JOIN leases l ON l.id = c.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     JOIN tenants t ON t.id = c.tenant_id
     WHERE c.tracking_token = :token LIMIT 1`,
    { token },
  );
  return rows[0] || null;
}

/** Page de suivi du locataire : champs sûrs uniquement, journal filtré. */
async function getTrackingView(token) {
  const c = await findByTrackingToken(token);
  if (!c) throw new ApiError(404, 'Lien invalide ou expiré');
  const events = await listEvents(c.tenant_id, c.id, 'tenant');
  return {
    complaint: {
      code: c.code,
      title: c.title,
      category: c.category,
      priority: c.priority,
      status: c.status,
      // La description n'est montrée que si le locataire l'a écrite lui-même.
      description: c.reported_via_portal ? c.description : null,
      property: c.property_address,
      unit: c.unit_code,
      canComment: c.status !== 'fermee',
    },
    company: { name: c.company_name, phone: c.contact_phone || null },
    dates: summarizeDates(c, events),
    events,
    teamLabel: TEAM_LABEL,
  };
}

/** Réponse du locataire depuis sa page de suivi. */
async function addTenantComment(token, body) {
  const c = await findByTrackingToken(token);
  if (!c) throw new ApiError(404, 'Lien invalide ou expiré');
  if (c.status === 'fermee') throw new ApiError(400, 'Ce dossier est fermé : vous ne pouvez plus y répondre');
  const [[recent]] = await pool.query(
    `SELECT COUNT(*) AS n FROM complaint_events
     WHERE complaint_id = :id AND author_renter_id IS NOT NULL AND created_at > (CURRENT_TIMESTAMP - INTERVAL 1 HOUR)`,
    { id: c.id },
  );
  if (Number(recent.n) >= MAX_TENANT_COMMENTS_PER_HOUR) {
    throw new ApiError(429, 'Trop de messages envoyés. Réessayez dans une heure.');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await recordEvent(conn, {
      tenantId: c.tenant_id, complaintId: c.id, type: 'comment', body, visibility: 'tenant', renterId: c.renter_id,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Plaintes d'un locataire (portail) avec leur lien de suivi, le plus récent d'abord. */
async function listForRenter(tenantId, renterId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.code, c.title, c.status, c.created_at,
            (SELECT MAX(e.created_at) FROM complaint_events e WHERE e.complaint_id = c.id AND e.visibility = 'tenant') AS last_activity
     FROM complaints c JOIN leases l ON l.id = c.lease_id
     WHERE c.tenant_id = :tenantId AND l.renter_id = :renterId
     ORDER BY c.created_at DESC, c.id DESC LIMIT 50`,
    { tenantId, renterId },
  );
  const out = [];
  for (const r of rows) {
    const trackingToken = await ensureTrackingToken(pool, r.id);
    out.push({
      code: r.code, title: r.title, status: r.status,
      reportedAt: iso(r.created_at), lastActivityAt: iso(r.last_activity || r.created_at),
      trackingPath: `/suivi/${trackingToken}`,
    });
  }
  return out;
}

module.exports = {
  recordReported,
  ensureTrackingToken,
  listEvents,
  summarizeDates,
  applyStaffUpdate,
  getTrackingView,
  addTenantComment,
  listForRenter,
  MAX_TENANT_COMMENTS_PER_HOUR,
};
