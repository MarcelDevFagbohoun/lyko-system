'use strict';

/**
 * « Biens à vendre » (demande utilisateur, 2026-10-18) — catalogue INTERNE (jamais publié
 * publiquement pour l'instant, décision explicite) des biens que le cabinet est chargé de vendre.
 * Concept entièrement séparé des Biens locatifs (`routes/properties.js`) — voir migration 093.
 * Permission dédiée `biens_a_vendre`, jamais accordée par défaut : seuls les employés à qui le DG
 * l'a explicitement donnée y accèdent (le DG a toujours accès à tout, comme partout ailleurs).
 */

const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  createSalePropertySchema,
  updateSalePropertySchema,
  deleteSalePropertySchema,
  markSoldSchema,
} = require('../validators/saleProperties');
const { SALE_PROPERTY_TYPES } = require('../constants/saleProperties');
const { toActor } = require('../utils/actor');
const { assertUploadType, randomFileName, toProtectedFileUrl } = require('../utils/uploads');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('../services/accountingPeriods');
const { claimIdempotencyKey } = require('../services/paymentGuards');
const { genererEcriture, isModuleActive } = require('../services/gl/glPostingService');
const logger = require('../utils/logger');

const { requireFeature } = require('../services/entitlements');
const { isoDate } = require('../utils/dates');
const router = Router();
router.use(requireAuth, requirePermission('biens_a_vendre'), requireFeature('sale_properties'));

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const TYPE_LABELS = Object.fromEntries(SALE_PROPERTY_TYPES.map((t) => [t.key, t.label]));
// Même plafond que les annonces marketplace (étape 20) — assez pour montrer un bien sous plusieurs
// angles sans en faire une galerie professionnelle à gérer.
const MAX_PHOTOS = 6;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: MAX_PHOTOS } });

function toPublic(row) {
  return {
    id: row.id,
    type: row.type,
    typeLabel: TYPE_LABELS[row.type] ?? row.type,
    title: row.title,
    address: row.address,
    price: Number(row.price),
    surfaceM2: row.surface_m2 != null ? Number(row.surface_m2) : null,
    description: row.description,
    status: row.status,
    photoUrls: (row.photo_paths ?? []).map((p) => toProtectedFileUrl(p)),
    owner: row.owner_id ? { id: row.owner_id, name: row.owner_name, phone: row.owner_phone } : null,
    createdBy: toActor(row.creator_first_name, row.creator_last_name, row.creator_role),
    createdAt: row.created_at,
    updatedBy: toActor(row.updater_first_name, row.updater_last_name, row.updater_role),
    updatedAt: row.updated_at,
    // Vente (bouton « Vendu », demande utilisateur du 2026-10-18) — toujours NULL tant que
    // `status !== 'vendu'`.
    sale:
      row.status === 'vendu'
        ? {
            finalPrice: Number(row.final_price),
            commissionPercent: Number(row.commission_percent),
            commissionAmount: Number(row.commission_amount),
            paymentMethod: row.sold_payment_method,
            soldAt: isoDate(row.sold_at),
            soldBy: toActor(row.seller_first_name, row.seller_last_name, row.seller_role),
          }
        : null,
  };
}

const SELECT_BASE = `
  sp.*,
  o.name AS owner_name, o.phone AS owner_phone,
  cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role,
  uu.first_name AS updater_first_name, uu.last_name AS updater_last_name, uu.role AS updater_role,
  su.first_name AS seller_first_name, su.last_name AS seller_last_name, su.role AS seller_role
`;
const JOINS = `
  LEFT JOIN owners o ON o.id = sp.owner_id
  LEFT JOIN users cu ON cu.id = sp.created_by
  LEFT JOIN users uu ON uu.id = sp.updated_by
  LEFT JOIN users su ON su.id = sp.sold_by
`;

async function loadSaleProperty(tenantId, id) {
  const [rows] = await pool.query(
    `SELECT ${SELECT_BASE} FROM sale_properties sp ${JOINS} WHERE sp.id = :id AND sp.tenant_id = :tenantId AND sp.deleted_at IS NULL LIMIT 1`,
    { id, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Bien à vendre introuvable');
  return rows[0];
}

// GET /api/sale-properties?status=&q= — répertoire des biens à vendre.
router.get('/', async (req, res, next) => {
  try {
    const params = { tenantId: req.user.tenantId };
    let where = 'sp.tenant_id = :tenantId AND sp.deleted_at IS NULL';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status) {
      where += ' AND sp.status = :status';
      params.status = status;
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where += ' AND (sp.title LIKE :q OR sp.address LIKE :q)';
      params.q = `%${q}%`;
    }
    const [rows] = await pool.query(
      `SELECT ${SELECT_BASE} FROM sale_properties sp ${JOINS} WHERE ${where} ORDER BY sp.created_at DESC`,
      params,
    );
    res.json({ saleProperties: rows.map(toPublic) });
  } catch (err) {
    next(err);
  }
});

// GET /api/sale-properties/:id
router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const row = await loadSaleProperty(req.user.tenantId, id);
    res.json({ saleProperty: toPublic(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/sale-properties — création (texte uniquement ; les photos s'ajoutent ensuite via
// POST /:id/photos, pour ne jamais perdre l'enregistrement si une seule photo est invalide).
router.post('/', async (req, res, next) => {
  const parsed = createSalePropertySchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    if (data.ownerId) {
      const [ownerRows] = await pool.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
        id: data.ownerId,
        tenantId: req.user.tenantId,
      });
      if (!ownerRows[0]) throw new ApiError(404, 'Propriétaire introuvable');
    }

    const [result] = await pool.query(
      `INSERT INTO sale_properties (tenant_id, owner_id, type, title, address, price, surface_m2, description, photo_paths, created_by)
       VALUES (:tenantId, :ownerId, :type, :title, :address, :price, :surfaceM2, :description, :photoPaths, :createdBy)`,
      {
        tenantId: req.user.tenantId,
        ownerId: data.ownerId ?? null,
        type: data.type,
        title: data.title,
        address: data.address,
        price: data.price,
        surfaceM2: data.surfaceM2 ?? null,
        description: data.description,
        photoPaths: JSON.stringify([]),
        createdBy: req.user.id,
      },
    );

    logger.info('Bien à vendre créé', { tenantId: req.user.tenantId, saleId: result.insertId, by: req.user.id });
    const row = await loadSaleProperty(req.user.tenantId, result.insertId);
    res.status(201).json({ saleProperty: toPublic(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/sale-properties/:id — détails/prix/statut (jamais les photos ici, voir ci-dessous).
router.patch('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateSalePropertySchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const existing = await loadSaleProperty(req.user.tenantId, id);
    // Fiche figée une fois vendue (voir migration 094) — toute correction doit passer par une
    // suppression logique justifiée, jamais par un PATCH discret sur un bien déjà vendu.
    if (existing.status === 'vendu') {
      throw new ApiError(409, 'Ce bien est déjà vendu — la fiche est figée.');
    }

    if (data.ownerId) {
      const [ownerRows] = await pool.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
        id: data.ownerId,
        tenantId: req.user.tenantId,
      });
      if (!ownerRows[0]) throw new ApiError(404, 'Propriétaire introuvable');
    }

    const fields = ['updated_by = :updatedBy', 'updated_at = NOW()'];
    const params = { id, updatedBy: req.user.id };
    if (data.type !== undefined) { fields.push('type = :type'); params.type = data.type; }
    if (data.title !== undefined) { fields.push('title = :title'); params.title = data.title; }
    if (data.address !== undefined) { fields.push('address = :address'); params.address = data.address; }
    if (data.price !== undefined) { fields.push('price = :price'); params.price = data.price; }
    if (data.surfaceM2 !== undefined) { fields.push('surface_m2 = :surfaceM2'); params.surfaceM2 = data.surfaceM2; }
    if (data.description !== undefined) { fields.push('description = :description'); params.description = data.description; }
    if (data.ownerId !== undefined) { fields.push('owner_id = :ownerId'); params.ownerId = data.ownerId; }
    if (data.status !== undefined) { fields.push('status = :status'); params.status = data.status; }

    await pool.query(`UPDATE sale_properties SET ${fields.join(', ')} WHERE id = :id`, params);

    logger.info('Bien à vendre modifié', { tenantId: req.user.tenantId, saleId: id, by: req.user.id });
    const row = await loadSaleProperty(req.user.tenantId, id);
    res.json({ saleProperty: toPublic(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/sale-properties/:id/mark-sold — bouton « Vendu » (demande utilisateur, 2026-10-18) : prix
// final (peut différer du prix affiché), pourcentage de commission perçu, mode de règlement. 100 %
// produit du cabinet (même principe que les frais d'agence à l'entrée), jamais reversé au
// propriétaire éventuellement lié. Fige la fiche (voir le garde ajouté au PATCH ci-dessus).
router.post('/:id/mark-sold', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = markSoldSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;
  const soldAt = data.soldAt ?? isoDate(new Date());

  const conn = await pool.getConnection();
  try {
    const existing = await loadSaleProperty(req.user.tenantId, id);
    if (existing.status === 'vendu') throw new ApiError(409, 'Ce bien est déjà vendu.');
    await assertPeriodOpen(req.user.tenantId, soldAt);

    await conn.beginTransaction();
    // Bug évité (même classe que partout ailleurs dans ce projet) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, req.user.tenantId, soldAt);
    // Sérialise deux tentatives concurrentes de vendre la MÊME fiche — re-vérifie le statut sous
    // verrou (fenêtre ouverte entre le chargement ci-dessus et ce point).
    const [[locked]] = await conn.query('SELECT status FROM sale_properties WHERE id = :id FOR UPDATE', { id });
    if (locked.status === 'vendu') throw new ApiError(409, 'Ce bien est déjà vendu.');

    // Clé d'idempotence (étape 36) si fournie par le client — sinon le verrou ci-dessus reste la
    // seule protection contre un double-clic, comme pour les routes héritées sans clé.
    if (data.idempotencyKey) {
      await claimIdempotencyKey(conn, req.user.tenantId, 'sale_property_mark_sold', data.idempotencyKey);
    }

    const commissionAmount = Math.round((data.finalPrice * data.commissionPercent) / 100);

    await conn.query(
      `UPDATE sale_properties
       SET status = 'vendu', final_price = :finalPrice, commission_percent = :commissionPercent,
           commission_amount = :commissionAmount, sold_payment_method = :paymentMethod,
           sold_at = :soldAt, sold_by = :soldBy, updated_by = :soldBy, updated_at = NOW()
       WHERE id = :id`,
      {
        id,
        finalPrice: data.finalPrice,
        commissionPercent: data.commissionPercent,
        commissionAmount,
        paymentMethod: data.paymentMethod,
        soldAt,
        soldBy: req.user.id,
      },
    );

    if (commissionAmount > 0 && (await isModuleActive(conn, req.user.tenantId))) {
      await genererEcriture(conn, {
        tenantId: req.user.tenantId,
        operationType: 'vente_bien_commission_encaissee',
        entryDate: soldAt,
        amount: commissionAmount,
        paymentMethod: data.paymentMethod,
        narrationVars: { bien: existing.title },
        sourceTable: 'sale_properties',
        sourceId: id,
        createdBy: req.user.id,
        context: {},
      });
    }

    await conn.commit();

    logger.info('Bien à vendre marqué comme vendu', {
      tenantId: req.user.tenantId,
      saleId: id,
      finalPrice: data.finalPrice,
      commissionAmount,
      by: req.user.id,
    });

    const row = await loadSaleProperty(req.user.tenantId, id);
    res.json({ saleProperty: toPublic(row) });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// POST /api/sale-properties/:id/photos — ajoute jusqu'au plafond (MAX_PHOTOS), une ou plusieurs à la fois.
router.post('/:id/photos', upload.array('photos', MAX_PHOTOS), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const row = await loadSaleProperty(req.user.tenantId, id);
    const existing = row.photo_paths ?? [];
    const incoming = req.files ?? [];
    if (incoming.length === 0) throw new ApiError(400, 'Au moins une photo requise');
    if (existing.length + incoming.length > MAX_PHOTOS) {
      throw new ApiError(400, `Maximum ${MAX_PHOTOS} photos par bien — ${existing.length} déjà présente(s).`);
    }

    const dir = `tenants/${req.user.tenantId}/sale-properties/${id}`;
    await fs.mkdir(path.join(UPLOADS_ROOT, dir), { recursive: true });
    const newPaths = [];
    for (const file of incoming) {
      const ext = assertUploadType(file, { label: 'Photo' });
      const rel = `${dir}/${randomFileName('photo', ext)}`;
      await fs.writeFile(path.join(UPLOADS_ROOT, rel), file.buffer);
      newPaths.push(rel);
    }

    await pool.query('UPDATE sale_properties SET photo_paths = :photoPaths, updated_by = :by, updated_at = NOW() WHERE id = :id', {
      photoPaths: JSON.stringify([...existing, ...newPaths]),
      by: req.user.id,
      id,
    });

    const updated = await loadSaleProperty(req.user.tenantId, id);
    res.json({ saleProperty: toPublic(updated) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sale-properties/:id/photos/:index — retire UNE photo (jamais toutes d'un coup).
router.delete('/:id/photos/:index', async (req, res, next) => {
  const id = Number(req.params.id);
  const index = Number(req.params.index);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  if (!Number.isInteger(index) || index < 0) return next(new ApiError(400, 'Index de photo invalide'));

  try {
    const row = await loadSaleProperty(req.user.tenantId, id);
    const photos = row.photo_paths ?? [];
    if (index >= photos.length) throw new ApiError(404, 'Photo introuvable');

    const [removed] = photos.splice(index, 1);
    await pool.query('UPDATE sale_properties SET photo_paths = :photoPaths, updated_by = :by, updated_at = NOW() WHERE id = :id', {
      photoPaths: JSON.stringify(photos),
      by: req.user.id,
      id,
    });
    if (removed) await fs.unlink(path.join(UPLOADS_ROOT, removed)).catch(() => {});

    const updated = await loadSaleProperty(req.user.tenantId, id);
    res.json({ saleProperty: toPublic(updated) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sale-properties/:id { reason } — suppression logique (fiche créée par erreur).
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = deleteSalePropertySchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  }

  try {
    await loadSaleProperty(req.user.tenantId, id);
    await pool.query(
      `UPDATE sale_properties SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason WHERE id = :id`,
      { by: req.user.id, reason: parsed.data.reason, id },
    );
    logger.info('Bien à vendre supprimé (logique)', { tenantId: req.user.tenantId, saleId: id, by: req.user.id, reason: parsed.data.reason });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
