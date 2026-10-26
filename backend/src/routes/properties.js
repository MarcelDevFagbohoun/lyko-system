'use strict';

const { Router } = require('express');
const multer = require('multer');
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
const { toProtectedFileUrl } = require('../utils/uploads');
const logger = require('../utils/logger');
const properties = require('../services/properties');

const router = Router();
// Les Biens/Unités sont le patrimoine des propriétaires ET le logement des
// locataires : gérables par qui a `locataires` (formulaire historique,
// étape 4) OU `proprietaires` (étape 5, création d'un propriétaire « complet »
// avec ses biens rattachés) — pas l'un sans l'autre, sinon un employé
// n'ayant que `proprietaires` peut créer une fiche propriétaire mais jamais
// lui rattacher de bien ni d'unité.
router.use(requireAuth, requireAnyPermission('locataires', 'proprietaires'));

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
    agentAssignedAt: row.agent_assigned_at,
    address: row.address,
    // Coordonnées GPS (étape 13, idée n°10 : carte du portefeuille) : `null`
    // tant que personne n'a placé le repère sur la carte.
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    locationSetAt: row.location_set_at,
    type: row.property_type,
    levels: row.levels,
    photoUrls: (row.photo_paths || []).map((p) => toProtectedFileUrl(p)),
    // Sous-comptage SONEB/SBEE (étape 9bis) — configuration par immeuble.
    utilityConfig: {
      soneb: {
        submetered: !!row.soneb_submetered,
        unitPrice: row.soneb_unit_price != null ? Number(row.soneb_unit_price) : null,
        mainMeterNumber: row.soneb_main_meter_number,
        accountNumber: row.soneb_account_number,
        lossAllocation: row.soneb_loss_allocation,
      },
      sbee: {
        submetered: !!row.sbee_submetered,
        unitPrice: row.sbee_unit_price != null ? Number(row.sbee_unit_price) : null,
        mainMeterNumber: row.sbee_main_meter_number,
        accountNumber: row.sbee_account_number,
        lossAllocation: row.sbee_loss_allocation,
      },
    },
    createdBy: toActor(row.creator_first_name, row.creator_last_name, row.creator_role),
    createdAt: row.created_at,
    ...extra,
  };
}

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

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) ? id : null;
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
    const scopeAgentId = await resolvePropertyScope(req.user);
    const rows = await properties.listProperties(req.user.tenantId, scopeAgentId, q);
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
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const property = await properties.loadProperty(pool, req.user.tenantId, id, scopeAgentId);
    const units = await properties.listPropertyUnits(id);
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

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { propertyId, code } = await properties.createProperty(req.user.tenantId, req.user.id, scopeAgentId, parsed.data, req.files);
    logger.info('Bien créé', { tenantId: req.user.tenantId, propertyId, code, by: req.user.id });
    res.status(201).json({ propertyId, code });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/properties/:id — modifier un Bien (+ ajout de photos).
router.patch('/:id', upload.array('photos', MAX_PHOTOS_PER_PROPERTY), async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updatePropertySchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const updated = await properties.updateProperty(req.user.tenantId, req.user.id, id, scopeAgentId, parsed.data, req.files);
    res.json({ property: toPublicProperty(updated) });
  } catch (err) {
    next(err);
  }
});

// POST /api/properties/:id/units — ajouter une Unité locative à un Bien.
router.post('/:id/units', async (req, res, next) => {
  const propertyId = parseId(req.params.id);
  if (propertyId === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createUnitSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { unitId, code } = await properties.createUnit(req.user.tenantId, req.user.id, propertyId, scopeAgentId, parsed.data);
    logger.info('Unité créée', { tenantId: req.user.tenantId, propertyId, unitId, code, by: req.user.id });
    res.status(201).json({ unitId, code });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/properties/:id/units/:unitId — modifier une Unité (loyer, compteurs, statut manuel).
router.patch('/:id/units/:unitId', async (req, res, next) => {
  const propertyId = parseId(req.params.id);
  const unitId = parseId(req.params.unitId);
  if (propertyId === null || unitId === null) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  const parsed = updateUnitSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const unit = await properties.updateUnit(req.user.tenantId, propertyId, unitId, scopeAgentId, parsed.data);
    res.json({ unit: toPublicUnit(unit) });
  } catch (err) {
    next(err);
  }
});

// POST /api/properties/:id/units/:unitId/release — le locataire a quitté :
// termine le bail actif s'il y en a un, puis remet l'unité « Libre ». Action
// unique, déclenchable directement depuis la fiche du bien (pas besoin de
// retrouver le locataire).
router.post('/:id/units/:unitId/release', async (req, res, next) => {
  const propertyId = parseId(req.params.id);
  const unitId = parseId(req.params.unitId);
  if (propertyId === null || unitId === null) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { unit, releasedLeaseId } = await properties.releaseUnit(req.user.tenantId, propertyId, unitId, scopeAgentId);
    logger.info('Unité libérée', {
      tenantId: req.user.tenantId,
      propertyId,
      unitId,
      releasedLeaseId,
      by: req.user.id,
    });
    res.json({ unit: toPublicUnit(unit), releasedLeaseId });
  } catch (err) {
    next(err);
  }
});

// GET /api/properties/:id/recette?mois=AAAA-MM — recette nette du Bien pour
// ce mois, taux de commission appliqué (celui en vigueur ce mois-là) et
// répartition cabinet/propriétaire. Lecture financière : réservée à
// proprietaires/comptabilite (le routeur autorise déjà `locataires` en plus
// pour le reste du module — pas pour cette écran-ci, plus sensible).
router.get('/:id/recette', requireAnyPermission('proprietaires', 'comptabilite'), async (req, res, next) => {
  const propertyId = parseId(req.params.id);
  if (propertyId === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = recetteQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return next(new ApiError(400, 'Requête invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await properties.loadProperty(pool, req.user.tenantId, propertyId, scopeAgentId); // 404 si hors tenant/portée
    const recette = await getRecetteProprietaire(req.user.tenantId, propertyId, parsed.data.mois);
    res.json({ recette });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
