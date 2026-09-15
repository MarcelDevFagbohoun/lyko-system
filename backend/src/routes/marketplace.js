'use strict';

// Marketplace (demande directe de l'utilisateur) : quand une Unité se
// libère, le comptable, l'agent ou le DG peut publier une petite annonce
// (description + photos) — visible sur une page PUBLIQUE partageable (pas
// de lien secret comme les portails locataire/propriétaire : une annonce
// est faite pour être vue, WhatsApp/Facebook...). Simplifié à une seule
// action « Publier » (pas de formulaire de modification séparé) : republier
// remplace intégralement l'annonce précédente (description + photos), et
// elle disparaît automatiquement dès qu'un nouveau bail est signé sur cette
// Unité (voir routes/renters.js) — la prochaine vacance repart d'une
// annonce fraîche plutôt que de réafficher un contenu potentiellement
// obsolète (prix, description) sans qu'on ait pu y penser.

const { Router } = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const { z } = require('zod');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireAnyPermission } = require('../middleware/auth');
const { resolvePropertyScope } = require('../services/scope');
const { assertUploadType, randomFileName } = require('../utils/uploads');
const { optionalText } = require('../validators/renters');
const { updateRequestStatusSchema } = require('../validators/marketplaceAccounts');
const { toActor } = require('../utils/actor');
const logger = require('../utils/logger');

const router = Router();

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const MAX_PHOTOS = 6;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: MAX_PHOTOS },
});

const publishSchema = z.object({
  description: optionalText(2000),
});

function isoDateOnly(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

// Les libellés (désignation, type de bien) sont résolus côté client à
// partir de ces clés brutes — `lib/constants/properties.ts` a déjà
// `PROPERTY_TYPE_LABELS`/`unitDesignationLabel`, jamais dupliqués ici.
function toPublicListing(row) {
  return {
    id: row.id,
    unitId: row.unit_id,
    unitCode: row.unit_code,
    designation: row.designation,
    designationCustom: row.designation_custom,
    monthlyRent: Number(row.monthly_rent),
    furnished: !!row.furnished,
    propertyCode: row.property_code,
    propertyType: row.property_type,
    address: row.address,
    description: row.description,
    photoUrls: (row.photo_paths || []).map((p) => `/uploads/${p}`),
    publishedAt: isoDateOnly(row.published_at),
  };
}

const LISTING_JOIN = `
  FROM marketplace_listings ml
  JOIN property_units u ON u.id = ml.unit_id
  JOIN properties p ON p.id = u.property_id
`;
const LISTING_SELECT = `
  ml.id, ml.unit_id, ml.description, ml.photo_paths, ml.published_at,
  u.code AS unit_code, u.designation, u.designation_custom, u.monthly_rent, u.furnished, u.status,
  p.code AS property_code, p.address, p.property_type
`;

// GET /api/marketplace/public/:tenantId — page publique, AUCUNE authentification.
// Volontairement pas de lien secret (contrairement aux portails locataire/
// propriétaire) : une annonce est faite pour être partagée largement.
router.get('/public/:tenantId', async (req, res, next) => {
  const tenantId = Number(req.params.tenantId);
  if (!Number.isInteger(tenantId)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const [tenantRows] = await pool.query(
      'SELECT company_name, contact_phone, logo_path FROM tenants WHERE id = :tenantId LIMIT 1',
      { tenantId },
    );
    if (!tenantRows[0]) throw new ApiError(404, 'Introuvable');
    const [rows] = await pool.query(
      `SELECT ${LISTING_SELECT} ${LISTING_JOIN}
       WHERE ml.tenant_id = :tenantId AND u.status = 'libre'
       ORDER BY ml.published_at DESC`,
      { tenantId },
    );
    res.json({
      tenant: {
        companyName: tenantRows[0].company_name,
        phone: tenantRows[0].contact_phone,
        logoUrl: tenantRows[0].logo_path ? `/uploads/${tenantRows[0].logo_path}` : null,
      },
      listings: rows.map(toPublicListing),
    });
  } catch (err) {
    next(err);
  }
});

router.use(requireAuth, requireAnyPermission('locataires', 'proprietaires'));

/** Charge une Unité de l'entreprise courante (+ son Bien), ou lève 404 — même
 * garde de portée agent (étape 14) que partout ailleurs sur le patrimoine. */
async function loadUnitForListing(tenantId, unitId, scopeAgentId) {
  const [rows] = await pool.query(
    `SELECT u.*, p.agent_id AS property_agent_id
     FROM property_units u
     JOIN properties p ON p.id = u.property_id
     WHERE u.id = :unitId AND u.tenant_id = :tenantId LIMIT 1`,
    { unitId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Unité introuvable');
  if (scopeAgentId != null && Number(rows[0].property_agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Unité introuvable');
  }
  return rows[0];
}

// GET /api/marketplace — mes annonces publiées (gestion interne).
router.get('/', async (req, res, next) => {
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const params = { tenantId: req.user.tenantId };
    let scopeClause = '';
    if (scopeAgentId != null) {
      scopeClause = ' AND p.agent_id = :scopeAgentId';
      params.scopeAgentId = scopeAgentId;
    }
    const [rows] = await pool.query(
      `SELECT ${LISTING_SELECT} ${LISTING_JOIN}
       WHERE ml.tenant_id = :tenantId ${scopeClause}
       ORDER BY ml.published_at DESC`,
      params,
    );
    res.json({ listings: rows.map(toPublicListing) });
  } catch (err) {
    next(err);
  }
});

// POST /api/marketplace/:unitId — publier (ou republier, remplace tout) une annonce.
router.post('/:unitId', upload.array('photos', MAX_PHOTOS), async (req, res, next) => {
  const unitId = Number(req.params.unitId);
  if (!Number.isInteger(unitId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const unit = await loadUnitForListing(req.user.tenantId, unitId, scopeAgentId);
    if (unit.status !== 'libre') {
      throw new ApiError(400, 'Cette unité n\'est pas vacante — impossible de la publier sur la marketplace.');
    }

    const [existing] = await conn.query('SELECT photo_paths FROM marketplace_listings WHERE unit_id = :unitId', {
      unitId,
    });
    const oldPhotoPaths = existing[0]?.photo_paths ?? [];

    const dir = `tenants/${req.user.tenantId}/marketplace/${unitId}`;
    await fs.mkdir(path.join(UPLOADS_ROOT, dir), { recursive: true });
    const newPhotoPaths = [];
    for (const file of req.files ?? []) {
      const ext = assertUploadType(file, { label: 'Photo' });
      const rel = `${dir}/${randomFileName('photo', ext)}`;
      await fs.writeFile(path.join(UPLOADS_ROOT, rel), file.buffer);
      newPhotoPaths.push(rel);
    }

    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO marketplace_listings (tenant_id, unit_id, description, photo_paths, published_by)
       VALUES (:tenantId, :unitId, :description, :photoPaths, :by)
       ON DUPLICATE KEY UPDATE
         description = :description, photo_paths = :photoPaths, published_at = NOW(), published_by = :by`,
      {
        tenantId: req.user.tenantId,
        unitId,
        description: parsed.data.description,
        photoPaths: JSON.stringify(newPhotoPaths),
        by: req.user.id,
      },
    );
    await conn.commit();

    for (const rel of oldPhotoPaths) {
      await fs.unlink(path.join(UPLOADS_ROOT, rel)).catch(() => {});
    }

    logger.info('Annonce marketplace publiée', { tenantId: req.user.tenantId, unitId, by: req.user.id });
    const [rows] = await pool.query(`SELECT ${LISTING_SELECT} ${LISTING_JOIN} WHERE ml.unit_id = :unitId`, { unitId });
    res.status(201).json({ listing: toPublicListing(rows[0]) });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// DELETE /api/marketplace/:unitId — retirer une annonce de la marketplace.
router.delete('/:unitId', async (req, res, next) => {
  const unitId = Number(req.params.unitId);
  if (!Number.isInteger(unitId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadUnitForListing(req.user.tenantId, unitId, scopeAgentId);

    const [rows] = await pool.query('SELECT photo_paths FROM marketplace_listings WHERE unit_id = :unitId AND tenant_id = :tenantId', {
      unitId,
      tenantId: req.user.tenantId,
    });
    if (!rows[0]) throw new ApiError(404, 'Aucune annonce pour cette unité');

    await pool.query('DELETE FROM marketplace_listings WHERE unit_id = :unitId AND tenant_id = :tenantId', {
      unitId,
      tenantId: req.user.tenantId,
    });
    for (const rel of rows[0].photo_paths || []) {
      await fs.unlink(path.join(UPLOADS_ROOT, rel)).catch(() => {});
    }

    logger.info('Annonce marketplace retirée', { tenantId: req.user.tenantId, unitId, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// --- Demandes « confier un bien » reçues depuis Quick Immo (site externe) -

// GET /api/marketplace/requests — gestion interne, toutes les demandes du cabinet.
router.get('/requests', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.request_type, r.address, r.description, r.status, r.created_at, r.reviewed_at,
              a.first_name, a.last_name, a.phone,
              ru.first_name AS reviewer_first_name, ru.last_name AS reviewer_last_name, ru.role AS reviewer_role
       FROM marketplace_requests r
       JOIN marketplace_accounts a ON a.id = r.account_id
       LEFT JOIN users ru ON ru.id = r.reviewed_by
       WHERE r.tenant_id = :tenantId
       ORDER BY (r.status = 'en_attente') DESC, r.created_at DESC`,
      { tenantId: req.user.tenantId },
    );
    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        requestType: r.request_type,
        address: r.address,
        description: r.description,
        status: r.status,
        createdAt: r.created_at,
        owner: { name: `${r.first_name} ${r.last_name}`, phone: r.phone },
        reviewedBy: r.reviewer_first_name ? toActor(r.reviewer_first_name, r.reviewer_last_name, r.reviewer_role) : null,
        reviewedAt: r.reviewed_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/marketplace/requests/:id — marquer contactée/acceptée/refusée.
router.patch('/requests/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = updateRequestStatusSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));

  try {
    const [rows] = await pool.query('SELECT id FROM marketplace_requests WHERE id = :id AND tenant_id = :tenantId', {
      id,
      tenantId: req.user.tenantId,
    });
    if (!rows[0]) throw new ApiError(404, 'Demande introuvable');

    await pool.query(
      'UPDATE marketplace_requests SET status = :status, reviewed_by = :by, reviewed_at = NOW() WHERE id = :id',
      { status: parsed.data.status, by: req.user.id, id },
    );
    logger.info('Demande marketplace mise à jour', {
      tenantId: req.user.tenantId,
      requestId: id,
      status: parsed.data.status,
      by: req.user.id,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
