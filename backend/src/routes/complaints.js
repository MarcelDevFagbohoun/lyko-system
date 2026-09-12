'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  createComplaintSchema,
  updateComplaintSchema,
  updateComplaintStatusSchema,
} = require('../validators/complaints');
const {
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  MAX_PHOTOS_PER_COMPLAINT,
} = require('../constants/complaints');
const { UNIT_DESIGNATIONS } = require('../constants/properties');
const { toActor } = require('../utils/actor');
const { assertUploadType, randomFileName } = require('../utils/uploads');
const { resolvePropertyScope } = require('../services/scope');
const logger = require('../utils/logger');

const router = Router();
router.use(requireAuth, requirePermission('plaintes'));

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: MAX_PHOTOS_PER_COMPLAINT },
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new ApiError(400, 'Photos : formats acceptés PNG, JPEG, WEBP (3 Mo max par photo)'));
    }
    cb(null, true);
  },
});

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function unitDesignationLabel(row) {
  return row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
}

function toPublicComplaint(row) {
  return {
    id: row.id,
    code: row.code,
    category: row.category,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    photoUrls: (row.photo_paths || []).map((p) => `/uploads/${p}`),
    resolutionNote: row.resolution_note,
    resolvedAt: isoDate(row.resolved_at),
    resolvedBy: toActor(row.resolver_first_name, row.resolver_last_name, row.resolver_role),
    reportedAt: isoDate(row.reported_at),
    // Signalée depuis le portail locataire : pas d'employé auteur
    // (`createdBy` reste null), `reportedViaPortal` distingue l'origine
    // pour l'affichage (« Signalé par le locataire » plutôt qu'un tiret).
    createdBy: toActor(row.declarer_first_name, row.declarer_last_name, row.declarer_role),
    reportedViaPortal: !!row.reported_via_portal,
    createdAt: row.created_at,
    lease: {
      id: row.lease_id,
      status: row.lease_status,
    },
    renter: {
      id: row.renter_id,
      firstName: row.renter_first_name,
      lastName: row.renter_last_name,
      phone: row.renter_phone,
    },
    unit: {
      id: row.unit_id,
      code: row.unit_code,
      designationLabel: unitDesignationLabel(row),
    },
    property: {
      id: row.property_id,
      code: row.property_code,
      address: row.property_address,
    },
  };
}

// Colonnes communes plainte + bail + unité + bien + locataire + auteurs
// (déclarant, résolveur).
const COMPLAINT_SELECT = `
  c.*,
  l.status AS lease_status,
  r.id AS renter_id, r.first_name AS renter_first_name, r.last_name AS renter_last_name, r.phone AS renter_phone,
  u.id AS unit_id, u.code AS unit_code, u.designation, u.designation_custom,
  p.id AS property_id, p.code AS property_code, p.address AS property_address,
  du.first_name AS declarer_first_name, du.last_name AS declarer_last_name, du.role AS declarer_role,
  su.first_name AS resolver_first_name, su.last_name AS resolver_last_name, su.role AS resolver_role
`;
const COMPLAINT_JOINS = `
  FROM complaints c
  JOIN leases l ON l.id = c.lease_id
  JOIN renters r ON r.id = l.renter_id
  JOIN property_units u ON u.id = l.unit_id
  JOIN properties p ON p.id = u.property_id
  LEFT JOIN users du ON du.id = c.created_by
  LEFT JOIN users su ON su.id = c.resolved_by
`;

async function nextComplaintCode(conn, tenantId) {
  const year = new Date().getFullYear();
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM complaints WHERE tenant_id = :tenantId AND code LIKE :prefix`,
    { tenantId, prefix: `INC-${year}-%` },
  );
  const seq = Number(rows[0].n) + 1;
  return `INC-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Charge un bail actif de l'entreprise courante, ou lève une erreur
 * explicite. `scopeAgentId` (étape 14) : un agent restreint ne peut déclarer
 * une plainte que sur un bail dont le Bien lui est attribué.
 */
async function loadActiveLease(conn, tenantId, leaseId, scopeAgentId = null) {
  const [rows] = await conn.query(
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
  if (rows[0].status !== 'active') throw new ApiError(400, 'Ce bail est terminé : impossible d\'y rattacher une plainte');
  return rows[0];
}

// GET /api/complaints/meta — catalogues pour construire les formulaires.
router.get('/meta', (_req, res) => {
  res.json({ categories: COMPLAINT_CATEGORIES, priorities: COMPLAINT_PRIORITIES, statuses: COMPLAINT_STATUSES });
});

// GET /api/complaints?status=&q=&leaseId= — registre des plaintes.
router.get('/', async (req, res, next) => {
  try {
    const params = { tenantId: req.user.tenantId };
    let where = 'c.tenant_id = :tenantId';

    // Portée « Biens gérés » (étape 14) : un agent restreint ne voit que les
    // plaintes rattachées à un Bien qui lui est attribué.
    const scopeAgentId = await resolvePropertyScope(req.user);
    if (scopeAgentId != null) {
      where += ' AND p.agent_id = :scopeAgentId';
      params.scopeAgentId = scopeAgentId;
    }

    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && COMPLAINT_STATUSES.includes(status)) {
      where += ' AND c.status = :status';
      params.status = status;
    }

    const leaseId = Number(req.query.leaseId);
    if (Number.isInteger(leaseId) && leaseId > 0) {
      where += ' AND c.lease_id = :leaseId';
      params.leaseId = leaseId;
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where += ' AND (c.code LIKE :q OR c.title LIKE :q OR r.first_name LIKE :q OR r.last_name LIKE :q OR u.code LIKE :q)';
      params.q = `%${q}%`;
    }

    // Tri par urgence, pas par date : les dossiers ouverts/en cours et
    // urgents remontent en tête, les résolues puis les fermées (les moins
    // actionnables) descendent en bas — la date ne départage qu'à égalité.
    const [rows] = await pool.query(
      `SELECT ${COMPLAINT_SELECT} ${COMPLAINT_JOINS}
       WHERE ${where}
       ORDER BY
         CASE
           WHEN c.status = 'ouverte' AND c.priority = 'urgente' THEN 1
           WHEN c.status = 'en_cours' AND c.priority = 'urgente' THEN 2
           WHEN c.status = 'ouverte' THEN 3
           WHEN c.status = 'en_cours' THEN 4
           WHEN c.status = 'resolue' THEN 5
           ELSE 6
         END,
         c.created_at DESC`,
      params,
    );

    res.json({ complaints: rows.map(toPublicComplaint) });
  } catch (err) {
    next(err);
  }
});

// GET /api/complaints/:id — dossier complet.
router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const params = { id, tenantId: req.user.tenantId };
    let scopeClause = '';
    if (scopeAgentId != null) {
      scopeClause = ' AND p.agent_id = :scopeAgentId';
      params.scopeAgentId = scopeAgentId;
    }
    const [rows] = await pool.query(
      `SELECT ${COMPLAINT_SELECT} ${COMPLAINT_JOINS} WHERE c.id = :id AND c.tenant_id = :tenantId ${scopeClause} LIMIT 1`,
      params,
    );
    if (!rows[0]) throw new ApiError(404, 'Plainte introuvable');
    res.json({ complaint: toPublicComplaint(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/complaints — déclarer une plainte/incident sur un bail actif.
router.post('/', upload.array('photos', MAX_PHOTOS_PER_COMPLAINT), async (req, res, next) => {
  const parsed = createComplaintSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadActiveLease(conn, req.user.tenantId, data.leaseId, scopeAgentId);
    const code = await nextComplaintCode(conn, req.user.tenantId);

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO complaints
         (tenant_id, lease_id, code, category, title, description, priority, reported_at, created_by)
       VALUES (:tenantId, :leaseId, :code, :category, :title, :description, :priority, :reportedAt, :by)`,
      {
        tenantId: req.user.tenantId,
        leaseId: data.leaseId,
        code,
        category: data.category,
        title: data.title,
        description: data.description,
        priority: data.priority,
        reportedAt: data.reportedAt || new Date().toISOString().slice(0, 10),
        by: req.user.id,
      },
    );
    const complaintId = result.insertId;

    if (req.files && req.files.length > 0) {
      const dir = path.join(UPLOADS_ROOT, `tenants/${req.user.tenantId}/complaints/${complaintId}`);
      await fs.mkdir(dir, { recursive: true });
      const photoPaths = await Promise.all(
        req.files.map(async (file, i) => {
          const ext = assertUploadType(file, { label: 'Photo' });
          const rel = `tenants/${req.user.tenantId}/complaints/${complaintId}/${randomFileName(`photo-${i + 1}`, ext)}`;
          await fs.writeFile(path.join(UPLOADS_ROOT, rel), file.buffer);
          return rel;
        }),
      );
      await conn.query('UPDATE complaints SET photo_paths = :paths WHERE id = :id', {
        paths: JSON.stringify(photoPaths),
        id: complaintId,
      });
    }

    await conn.commit();
    logger.info('Plainte déclarée', { tenantId: req.user.tenantId, complaintId, code, by: req.user.id });
    res.status(201).json({ complaintId, code });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

/**
 * Charge une plainte de l'entreprise courante, ou lève 404. `scopeAgentId`
 * (étape 14) : un agent restreint n'accède qu'aux plaintes dont le Bien lui
 * est attribué.
 */
async function loadComplaint(conn, tenantId, id, scopeAgentId = null) {
  const [rows] = await conn.query(
    `SELECT c.*, p.agent_id AS property_agent_id
     FROM complaints c
     JOIN leases l ON l.id = c.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE c.id = :id AND c.tenant_id = :tenantId LIMIT 1`,
    { id, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Plainte introuvable');
  if (scopeAgentId != null && Number(rows[0].property_agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Plainte introuvable');
  }
  return rows[0];
}

// PATCH /api/complaints/:id — corriger catégorie/titre/description/priorité.
router.patch('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateComplaintSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadComplaint(pool, req.user.tenantId, id, scopeAgentId);

    const fields = [];
    const params = { id };
    if (data.category !== undefined) { fields.push('category = :category'); params.category = data.category; }
    if (data.title !== undefined) { fields.push('title = :title'); params.title = data.title; }
    if (data.description !== undefined) { fields.push('description = :description'); params.description = data.description; }
    if (data.priority !== undefined) { fields.push('priority = :priority'); params.priority = data.priority; }

    if (fields.length > 0) {
      await pool.query(`UPDATE complaints SET ${fields.join(', ')} WHERE id = :id`, params);
    }

    const [rows] = await pool.query(
      `SELECT ${COMPLAINT_SELECT} ${COMPLAINT_JOINS} WHERE c.id = :id LIMIT 1`,
      { id },
    );
    res.json({ complaint: toPublicComplaint(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/complaints/:id/status — faire avancer le dossier (ouverte → en_cours → résolue → fermée).
router.patch('/:id/status', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateComplaintStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadComplaint(pool, req.user.tenantId, id, scopeAgentId);

    const fields = ['status = :status'];
    const params = { id, status: data.status };
    if (data.resolutionNote !== undefined) {
      fields.push('resolution_note = :note');
      params.note = data.resolutionNote;
    }
    if (data.status === 'resolue') {
      fields.push('resolved_at = :resolvedAt', 'resolved_by = :resolvedBy');
      params.resolvedAt = new Date().toISOString().slice(0, 10);
      params.resolvedBy = req.user.id;
    }

    await pool.query(`UPDATE complaints SET ${fields.join(', ')} WHERE id = :id`, params);

    logger.info('Statut de plainte modifié', { tenantId: req.user.tenantId, complaintId: id, status: data.status, by: req.user.id });

    const [rows] = await pool.query(
      `SELECT ${COMPLAINT_SELECT} ${COMPLAINT_JOINS} WHERE c.id = :id LIMIT 1`,
      { id },
    );
    res.json({ complaint: toPublicComplaint(rows[0]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
