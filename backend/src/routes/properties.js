'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireAnyPermission } = require('../middleware/auth');
const {
  createPropertySchema,
  updatePropertySchema,
  createUnitSchema,
  updateUnitSchema,
} = require('../validators/properties');
const { recetteQuerySchema } = require('../validators/owners');
const { getRecetteProprietaire } = require('../services/commission');
const { resolvePropertyScope } = require('../services/scope');
const {
  PROPERTY_TYPES,
  UNIT_DESIGNATIONS,
  MAX_PHOTOS_PER_PROPERTY,
} = require('../constants/properties');
const { toActor } = require('../utils/actor');
const { assertUploadType, randomFileName } = require('../utils/uploads');
const logger = require('../utils/logger');

const router = Router();
// Les Biens/Unités sont le patrimoine des propriétaires ET le logement des
// locataires : gérables par qui a `locataires` (formulaire historique,
// étape 4) OU `proprietaires` (étape 5, création d'un propriétaire « complet »
// avec ses biens rattachés) — pas l'un sans l'autre, sinon un employé
// n'ayant que `proprietaires` peut créer une fiche propriétaire mais jamais
// lui rattacher de bien ni d'unité.
router.use(requireAuth, requireAnyPermission('locataires', 'proprietaires'));

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: MAX_PHOTOS_PER_PROPERTY },
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new ApiError(400, 'Photos : formats acceptés PNG, JPEG, WEBP (3 Mo max par photo)'));
    }
    cb(null, true);
  },
});

function toPublicProperty(row, extra = {}) {
  return {
    id: row.id,
    code: row.code,
    owner: { id: row.owner_id, name: row.owner_name, phone: row.owner_phone },
    // Agent responsable (étape 14) : `null` si non attribué — tout Bien non
    // attribué reste visible par n'importe quel agent SANS AUCUNE attribution
    // (accès complet par défaut), voir services/scope.js.
    agent: row.agent_id ? { id: row.agent_id, name: `${row.agent_first_name} ${row.agent_last_name}` } : null,
    address: row.address,
    type: row.property_type,
    levels: row.levels,
    photoUrls: (row.photo_paths || []).map((p) => `/uploads/${p}`),
    // Sous-comptage SONEB/SBEE (étape 9bis) — configuration par immeuble.
    utilityConfig: {
      soneb: {
        submetered: !!row.soneb_submetered,
        unitPrice: row.soneb_unit_price != null ? Number(row.soneb_unit_price) : null,
        mainMeterNumber: row.soneb_main_meter_number,
        accountNumber: row.soneb_account_number,
      },
      sbee: {
        submetered: !!row.sbee_submetered,
        unitPrice: row.sbee_unit_price != null ? Number(row.sbee_unit_price) : null,
        mainMeterNumber: row.sbee_main_meter_number,
        accountNumber: row.sbee_account_number,
      },
    },
    createdBy: toActor(row.creator_first_name, row.creator_last_name, row.creator_role),
    createdAt: row.created_at,
    ...extra,
  };
}

// Bien + son propriétaire joint (nom/téléphone) + son créateur (nom/rôle) :
// réutilisé par la liste, la fiche et la création d'un Bien existant.
const PROPERTY_WITH_OWNER_SELECT = `
  p.*, o.name AS owner_name, o.phone AS owner_phone,
  cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role,
  au.first_name AS agent_first_name, au.last_name AS agent_last_name
`;
const PROPERTY_WITH_OWNER_JOINS = `
  JOIN owners o ON o.id = p.owner_id
  LEFT JOIN users cu ON cu.id = p.created_by
  LEFT JOIN users au ON au.id = p.agent_id
`;

function toPublicUnit(row, extra = {}) {
  return {
    id: row.id,
    propertyId: row.property_id,
    code: row.code,
    designation: row.designation,
    designationCustom: row.designation_custom,
    status: row.status,
    monthlyRent: Number(row.monthly_rent),
    sonebMeterNumber: row.soneb_meter_number,
    sbeeMeterNumber: row.sbee_meter_number,
    furnished: !!row.furnished,
    createdBy: toActor(row.creator_first_name, row.creator_last_name, row.creator_role),
    ...extra,
  };
}

/**
 * Charge un Bien de l'entreprise courante (+ son propriétaire), ou lève 404.
 * `scopeAgentId` (voir services/scope.js) : si fourni (agent restreint à un
 * sous-ensemble du portefeuille), un Bien attribué à un AUTRE agent (ou à
 * personne) répond aussi 404 — jamais 403, pour ne jamais confirmer qu'un
 * Bien existe à un agent qui ne le gère pas.
 */
async function loadProperty(conn, tenantId, propertyId, scopeAgentId = null) {
  const [rows] = await conn.query(
    `SELECT ${PROPERTY_WITH_OWNER_SELECT} FROM properties p ${PROPERTY_WITH_OWNER_JOINS}
     WHERE p.id = :id AND p.tenant_id = :tenantId LIMIT 1`,
    { id: propertyId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Bien introuvable');
  if (scopeAgentId != null && Number(rows[0].agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Bien introuvable');
  }
  return rows[0];
}

/** Vérifie que le propriétaire appartient à l'entreprise courante, ou lève 404. */
async function assertOwnerExists(conn, tenantId, ownerId) {
  const [rows] = await conn.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
    id: ownerId,
    tenantId,
  });
  if (!rows[0]) throw new ApiError(404, 'Propriétaire introuvable');
}

async function nextPropertyCode(conn, tenantId) {
  const [rows] = await conn.query('SELECT COUNT(*) AS n FROM properties WHERE tenant_id = :tenantId', { tenantId });
  return `BIEN-${String(Number(rows[0].n) + 1).padStart(3, '0')}`;
}

async function nextUnitCode(conn, propertyCode, propertyId) {
  const [rows] = await conn.query('SELECT COUNT(*) AS n FROM property_units WHERE property_id = :propertyId', {
    propertyId,
  });
  return `${propertyCode}-U${String(Number(rows[0].n) + 1).padStart(2, '0')}`;
}

// GET /api/properties/meta — catalogues pour construire les formulaires.
router.get('/meta', (_req, res) => {
  res.json({ propertyTypes: PROPERTY_TYPES, unitDesignations: UNIT_DESIGNATIONS });
});

// GET /api/properties?q=... — liste des Biens, avec recherche par propriétaire ou code
// (autocomplétion pour la sélection d'un bien lors de la création d'un locataire).
router.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const params = { tenantId: req.user.tenantId };
    let where = 'p.tenant_id = :tenantId';
    if (q) {
      where += ' AND (o.name LIKE :q OR p.code LIKE :q)';
      params.q = `%${q}%`;
    }
    // Portée « Biens gérés » (étape 14) : un agent restreint ne voit que ses
    // propres Biens attribués — voir services/scope.js.
    const scopeAgentId = await resolvePropertyScope(req.user);
    if (scopeAgentId != null) {
      where += ' AND p.agent_id = :scopeAgentId';
      params.scopeAgentId = scopeAgentId;
    }

    const [rows] = await pool.query(
      `SELECT ${PROPERTY_WITH_OWNER_SELECT},
              COUNT(u.id) AS units_count,
              SUM(CASE WHEN u.status = 'libre' THEN 1 ELSE 0 END) AS units_free
       FROM properties p
       ${PROPERTY_WITH_OWNER_JOINS}
       LEFT JOIN property_units u ON u.property_id = p.id
       WHERE ${where}
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      params,
    );

    res.json({
      properties: rows.map((r) =>
        toPublicProperty(r, { unitsCount: Number(r.units_count), unitsFree: Number(r.units_free) }),
      ),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/properties/:id — fiche du Bien + tableau de ses unités.
router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const property = await loadProperty(pool, req.user.tenantId, id, scopeAgentId);

    const [units] = await pool.query(
      `SELECT u.*, l.id AS active_lease_id, r.id AS renter_id, r.first_name, r.last_name,
              cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role
       FROM property_units u
       LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
       LEFT JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users cu ON cu.id = u.created_by
       WHERE u.property_id = :id
       ORDER BY u.code`,
      { id },
    );

    res.json({
      property: toPublicProperty(property),
      units: units.map((u) =>
        toPublicUnit(u, {
          currentRenter: u.renter_id ? { id: u.renter_id, name: `${u.first_name} ${u.last_name}` } : null,
        }),
      ),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/properties — créer un Bien (+ photos optionnelles).
router.post('/', upload.array('photos', MAX_PHOTOS_PER_PROPERTY), async (req, res, next) => {
  const parsed = createPropertySchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    await assertOwnerExists(conn, req.user.tenantId, data.ownerId);

    // Un agent déjà restreint à un sous-ensemble du portefeuille (étape 14)
    // qui crée un nouveau Bien doit pouvoir le retrouver ensuite — sinon il
    // disparaîtrait aussitôt de sa propre vue (non attribué = hors de sa
    // portée). Auto-attribution à lui-même ; le DG (ou un agent encore sans
    // aucune attribution, donc en accès complet) crée toujours un Bien non
    // attribué, à répartir ensuite depuis la fiche de l'employé.
    const scopeAgentId = await resolvePropertyScope(req.user);

    await conn.beginTransaction();

    const code = await nextPropertyCode(conn, req.user.tenantId);
    const [result] = await conn.query(
      `INSERT INTO properties (tenant_id, code, owner_id, agent_id, address, property_type, levels, created_by)
       VALUES (:tenantId, :code, :ownerId, :agentId, :address, :type, :levels, :createdBy)`,
      {
        tenantId: req.user.tenantId,
        code,
        ownerId: data.ownerId,
        agentId: scopeAgentId,
        address: data.address,
        type: data.propertyType,
        levels: data.levels ?? null,
        createdBy: req.user.id,
      },
    );
    const propertyId = result.insertId;

    let photoPaths = [];
    if (req.files && req.files.length > 0) {
      const dir = path.join(UPLOADS_ROOT, `tenants/${req.user.tenantId}/properties/${propertyId}`);
      await fs.mkdir(dir, { recursive: true });
      photoPaths = await Promise.all(
        req.files.map(async (file, i) => {
          const ext = assertUploadType(file, { label: 'Photo' });
          const rel = `tenants/${req.user.tenantId}/properties/${propertyId}/${randomFileName(`photo-${i + 1}`, ext)}`;
          await fs.writeFile(path.join(UPLOADS_ROOT, rel), file.buffer);
          return rel;
        }),
      );
      await conn.query('UPDATE properties SET photo_paths = :paths WHERE id = :id', {
        paths: JSON.stringify(photoPaths),
        id: propertyId,
      });
    }

    await conn.commit();
    logger.info('Bien créé', { tenantId: req.user.tenantId, propertyId, code, by: req.user.id });
    res.status(201).json({ propertyId, code });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// PATCH /api/properties/:id — modifier un Bien (+ ajout de photos).
router.patch('/:id', upload.array('photos', MAX_PHOTOS_PER_PROPERTY), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updatePropertySchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const property = await loadProperty(pool, req.user.tenantId, id, scopeAgentId);

    if (data.ownerId !== undefined) {
      await assertOwnerExists(pool, req.user.tenantId, data.ownerId);
    }

    const fields = [];
    const params = { id };
    if (data.ownerId !== undefined) { fields.push('owner_id = :ownerId'); params.ownerId = data.ownerId; }
    if (data.address !== undefined) { fields.push('address = :address'); params.address = data.address; }
    if (data.propertyType !== undefined) { fields.push('property_type = :type'); params.type = data.propertyType; }
    if (data.levels !== undefined) { fields.push('levels = :levels'); params.levels = data.levels; }

    let existingPhotos = property.photo_paths || [];
    if (req.files && req.files.length > 0) {
      const dir = path.join(UPLOADS_ROOT, `tenants/${req.user.tenantId}/properties/${id}`);
      await fs.mkdir(dir, { recursive: true });
      const startIndex = existingPhotos.length;
      const newPaths = await Promise.all(
        req.files.slice(0, Math.max(0, MAX_PHOTOS_PER_PROPERTY - existingPhotos.length)).map(async (file, i) => {
          const ext = assertUploadType(file, { label: 'Photo' });
          const rel = `tenants/${req.user.tenantId}/properties/${id}/${randomFileName(`photo-${startIndex + i + 1}`, ext)}`;
          await fs.writeFile(path.join(UPLOADS_ROOT, rel), file.buffer);
          return rel;
        }),
      );
      existingPhotos = [...existingPhotos, ...newPaths];
      fields.push('photo_paths = :photos');
      params.photos = JSON.stringify(existingPhotos);
    }

    if (fields.length > 0) {
      await pool.query(`UPDATE properties SET ${fields.join(', ')} WHERE id = :id`, params);
    }

    const updated = await loadProperty(pool, req.user.tenantId, id);
    res.json({ property: toPublicProperty(updated) });
  } catch (err) {
    next(err);
  }
});

// POST /api/properties/:id/units — ajouter une Unité locative à un Bien.
router.post('/:id/units', async (req, res, next) => {
  const propertyId = Number(req.params.id);
  if (!Number.isInteger(propertyId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createUnitSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const property = await loadProperty(conn, req.user.tenantId, propertyId, scopeAgentId);
    const code = await nextUnitCode(conn, property.code, propertyId);

    const [result] = await conn.query(
      `INSERT INTO property_units
         (tenant_id, property_id, code, designation, designation_custom, monthly_rent,
          soneb_meter_number, sbee_meter_number, furnished, created_by)
       VALUES (:tenantId, :propertyId, :code, :designation, :designationCustom, :rent,
               :sonebMeterNumber, :sbeeMeterNumber, :furnished, :createdBy)`,
      {
        tenantId: req.user.tenantId,
        propertyId,
        code,
        designation: data.designation,
        designationCustom: data.designationCustom,
        rent: data.monthlyRent,
        sonebMeterNumber: data.sonebMeterNumber,
        sbeeMeterNumber: data.sbeeMeterNumber,
        furnished: data.furnished ? 1 : 0,
        createdBy: req.user.id,
      },
    );

    logger.info('Unité créée', { tenantId: req.user.tenantId, propertyId, unitId: result.insertId, code, by: req.user.id });
    res.status(201).json({ unitId: result.insertId, code });
  } catch (err) {
    next(err);
  } finally {
    conn.release();
  }
});

// PATCH /api/properties/:id/units/:unitId — modifier une Unité (loyer, compteurs, statut manuel).
router.patch('/:id/units/:unitId', async (req, res, next) => {
  const propertyId = Number(req.params.id);
  const unitId = Number(req.params.unitId);
  if (!Number.isInteger(propertyId) || !Number.isInteger(unitId)) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  const parsed = updateUnitSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadProperty(pool, req.user.tenantId, propertyId, scopeAgentId);
    const [unitRows] = await pool.query(
      'SELECT * FROM property_units WHERE id = :unitId AND property_id = :propertyId LIMIT 1',
      { unitId, propertyId },
    );
    if (!unitRows[0]) throw new ApiError(404, 'Unité introuvable');

    if (data.status === 'loue') {
      const [activeLease] = await pool.query(
        "SELECT id FROM leases WHERE unit_id = :unitId AND status = 'active' LIMIT 1",
        { unitId },
      );
      if (!activeLease[0]) {
        throw new ApiError(400, "Impossible de marquer « Loué » sans bail actif : créez un locataire pour cette unité.");
      }
    }

    const fields = [];
    const params = { unitId };
    if (data.designation !== undefined) { fields.push('designation = :designation'); params.designation = data.designation; }
    if (data.designationCustom !== undefined) { fields.push('designation_custom = :designationCustom'); params.designationCustom = data.designationCustom; }
    if (data.monthlyRent !== undefined) { fields.push('monthly_rent = :rent'); params.rent = data.monthlyRent; }
    if (data.sonebMeterNumber !== undefined) { fields.push('soneb_meter_number = :soneb'); params.soneb = data.sonebMeterNumber; }
    if (data.sbeeMeterNumber !== undefined) { fields.push('sbee_meter_number = :sbee'); params.sbee = data.sbeeMeterNumber; }
    if (data.furnished !== undefined) { fields.push('furnished = :furnished'); params.furnished = data.furnished ? 1 : 0; }
    if (data.status !== undefined) { fields.push('status = :status'); params.status = data.status; }

    if (fields.length > 0) {
      await pool.query(`UPDATE property_units SET ${fields.join(', ')} WHERE id = :unitId`, params);
    }

    const [updated] = await pool.query(
      `SELECT u.*, cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role
       FROM property_units u LEFT JOIN users cu ON cu.id = u.created_by WHERE u.id = :unitId`,
      { unitId },
    );
    res.json({ unit: toPublicUnit(updated[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/properties/:id/units/:unitId/release — le locataire a quitté :
// termine le bail actif s'il y en a un, puis remet l'unité « Libre ». Action
// unique, déclenchable directement depuis la fiche du bien (pas besoin de
// retrouver le locataire).
router.post('/:id/units/:unitId/release', async (req, res, next) => {
  const propertyId = Number(req.params.id);
  const unitId = Number(req.params.unitId);
  if (!Number.isInteger(propertyId) || !Number.isInteger(unitId)) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadProperty(conn, req.user.tenantId, propertyId, scopeAgentId);
    const [unitRows] = await conn.query(
      'SELECT * FROM property_units WHERE id = :unitId AND property_id = :propertyId LIMIT 1',
      { unitId, propertyId },
    );
    if (!unitRows[0]) throw new ApiError(404, 'Unité introuvable');
    if (unitRows[0].status === 'libre') {
      throw new ApiError(400, 'Cette unité est déjà libre.');
    }

    const [activeLeaseRows] = await conn.query(
      "SELECT id FROM leases WHERE unit_id = :unitId AND tenant_id = :tenantId AND status = 'active' LIMIT 1",
      { unitId, tenantId: req.user.tenantId },
    );

    await conn.beginTransaction();
    let releasedLeaseId = null;
    if (activeLeaseRows[0]) {
      releasedLeaseId = activeLeaseRows[0].id;
      await conn.query(
        "UPDATE leases SET status = 'ended', end_date = :endDate WHERE id = :id",
        { endDate: new Date().toISOString().slice(0, 10), id: releasedLeaseId },
      );
    }
    await conn.query("UPDATE property_units SET status = 'libre' WHERE id = :unitId", { unitId });
    await conn.commit();

    logger.info('Unité libérée', {
      tenantId: req.user.tenantId,
      propertyId,
      unitId,
      releasedLeaseId,
      by: req.user.id,
    });

    const [updated] = await pool.query('SELECT * FROM property_units WHERE id = :unitId', { unitId });
    res.json({ unit: toPublicUnit(updated[0]), releasedLeaseId });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/properties/:id/recette?mois=AAAA-MM — recette nette du Bien pour
// ce mois, taux de commission appliqué (celui en vigueur ce mois-là) et
// répartition cabinet/propriétaire. Lecture financière : réservée à
// proprietaires/comptabilite (le routeur autorise déjà `locataires` en plus
// pour le reste du module — pas pour cette écran-ci, plus sensible).
router.get('/:id/recette', requireAnyPermission('proprietaires', 'comptabilite'), async (req, res, next) => {
  const propertyId = Number(req.params.id);
  if (!Number.isInteger(propertyId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = recetteQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return next(new ApiError(400, 'Requête invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadProperty(pool, req.user.tenantId, propertyId, scopeAgentId); // 404 si hors tenant/portée
    const recette = await getRecetteProprietaire(req.user.tenantId, propertyId, parsed.data.mois);
    res.json({ recette });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
