'use strict';

/**
 * Référentiel de prix pour la facturation des dégradations à l'état des
 * lieux de sortie — un catalogue par entreprise, réutilisé à chaque état
 * des lieux (voir migration 056). Lecture ouverte à qui fait des états des
 * lieux (l'agent doit pouvoir le consulter pendant sa saisie) ; écriture
 * réservée au DG, comme le taux de commission (`routes/owners.js`) — une
 * décision de politique tarifaire, pas une saisie opérationnelle.
 */

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');
const { createCatalogItemSchema, updateCatalogItemSchema } = require('../validators/inspectionCatalog');
const { toActor } = require('../utils/actor');
const logger = require('../utils/logger');

const router = Router();
router.use(requireAuth);

const canRead = requirePermission('etats_des_lieux');
const canManage = requireRole('dg');

function toPublicCatalogItem(row) {
  return {
    id: row.id,
    label: row.label,
    price: Number(row.price),
    createdBy: toActor(row.first_name, row.last_name, row.role),
    createdAt: row.created_at,
  };
}

// GET /api/inspection-catalog — liste triée alphabétiquement (facilite la recherche côté client).
router.get('/', canRead, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*, u.first_name, u.last_name, u.role
       FROM inspection_price_catalog c JOIN users u ON u.id = c.created_by
       WHERE c.tenant_id = :tenantId ORDER BY c.label ASC`,
      { tenantId: req.user.tenantId },
    );
    res.json({ items: rows.map(toPublicCatalogItem) });
  } catch (err) {
    next(err);
  }
});

// POST /api/inspection-catalog — nouvel élément du catalogue (DG uniquement).
router.post('/', canManage, async (req, res, next) => {
  const parsed = createCatalogItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const [result] = await pool.query(
      'INSERT INTO inspection_price_catalog (tenant_id, label, price, created_by) VALUES (:tenantId, :label, :price, :createdBy)',
      { tenantId: req.user.tenantId, label: data.label, price: data.price, createdBy: req.user.id },
    );
    logger.info('Élément du catalogue de facturation créé', {
      tenantId: req.user.tenantId,
      catalogItemId: result.insertId,
      by: req.user.id,
    });
    res.status(201).json({ catalogItemId: result.insertId });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/inspection-catalog/:id — modifier libellé/prix (DG uniquement).
router.patch('/:id', canManage, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateCatalogItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const [existing] = await pool.query(
      'SELECT id FROM inspection_price_catalog WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
      { id, tenantId: req.user.tenantId },
    );
    if (!existing[0]) throw new ApiError(404, 'Élément introuvable');

    const fields = [];
    const params = { id };
    if (data.label !== undefined) { fields.push('label = :label'); params.label = data.label; }
    if (data.price !== undefined) { fields.push('price = :price'); params.price = data.price; }
    if (fields.length > 0) {
      await pool.query(`UPDATE inspection_price_catalog SET ${fields.join(', ')} WHERE id = :id`, params);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/inspection-catalog/:id — jamais bloquant pour les états des
// lieux déjà enregistrés : le libellé/prix choisi y est copié, pas référencé.
router.delete('/:id', canManage, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const [result] = await pool.query(
      'DELETE FROM inspection_price_catalog WHERE id = :id AND tenant_id = :tenantId',
      { id, tenantId: req.user.tenantId },
    );
    if (result.affectedRows === 0) throw new ApiError(404, 'Élément introuvable');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
