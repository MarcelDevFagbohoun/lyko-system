'use strict';

// Fil de notes (messages datés) d'un locataire, propriétaire ou bien. Ouvert à tout employé authentifié
// (comme l'ancienne note locataire) ; la portée agent est respectée. Une note n'est jamais modifiée.
const { Router } = require('express');
const { z } = require('zod');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/error');
const { resolvePropertyScope, assertRenterInScope } = require('../services/scope');
const { toActor } = require('../utils/actor');
const noteSheets = require('../services/noteSheets');

const router = Router();
router.use(requireAuth);

const TABLES = { renter: 'renters', owner: 'owners', property: 'properties' };
const createSchema = z.object({
  entityType: z.enum(['renter', 'owner', 'property']),
  entityId: z.number().int().positive(),
  body: z.string().trim().min(1, 'Écrivez votre note.').max(2000),
});

async function assertEntity(user, type, id) {
  const [rows] = await pool.query(`SELECT * FROM ${TABLES[type]} WHERE id = :id AND tenant_id = :t LIMIT 1`, { id, t: user.tenantId });
  if (!rows[0]) throw new ApiError(404, 'Élément introuvable');
  const scopeAgentId = await resolvePropertyScope(user);
  if (type === 'renter') await assertRenterInScope(user.tenantId, id, scopeAgentId);
  if (type === 'property' && scopeAgentId != null && rows[0].agent_id !== scopeAgentId) throw new ApiError(404, 'Élément introuvable');
  if (type === 'owner' && scopeAgentId != null) {
    const [r] = await pool.query('SELECT 1 FROM properties WHERE owner_id = :id AND agent_id = :a LIMIT 1', { id, a: scopeAgentId });
    if (!r[0]) throw new ApiError(404, 'Élément introuvable');
  }
}

async function list(tenantId, type, id) {
  const [rows] = await pool.query(
    `SELECT n.id, n.body, n.created_at, u.first_name, u.last_name, u.role
     FROM entity_notes n LEFT JOIN users u ON u.id = n.author_id
     WHERE n.tenant_id = :tenantId AND n.entity_type = :type AND n.entity_id = :id
     ORDER BY n.created_at DESC, n.id DESC LIMIT 200`,
    { tenantId, type, id },
  );
  return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at, author: toActor(r.first_name, r.last_name, r.role) }));
}

router.get('/', async (req, res, next) => {
  try {
    const type = String(req.query.entityType);
    const id = Number(req.query.entityId);
    if (!TABLES[type] || !Number.isInteger(id)) throw new ApiError(400, 'Paramètres invalides');
    await assertEntity(req.user, type, id);
    res.json({ notes: await list(req.user.tenantId, type, id) });
  } catch (err) { next(err); }
});

// ── Fiche de notes (texte riche) d'un locataire ou d'un propriétaire ──────────────────────────────────────────────
// Les anciennes notes en messages restent lisibles (`legacyNotes`) mais on n'en ajoute plus : on écrit dans la fiche.
const SHEET_TYPES = ['renter', 'owner'];
const sheetQuerySchema = z.object({ entityType: z.enum(SHEET_TYPES), entityId: z.coerce.number().int().positive() });
const sheetSaveSchema = z.object({
  entityType: z.enum(SHEET_TYPES),
  entityId: z.number().int().positive(),
  content: z.string().max(noteSheets.MAX_LENGTH, 'La fiche est trop longue.'),
  version: z.number().int().min(0),
});

router.get('/sheet', async (req, res, next) => {
  try {
    const q = sheetQuerySchema.safeParse(req.query);
    if (!q.success) throw new ApiError(400, 'Paramètres invalides');
    const { entityType, entityId } = q.data;
    await assertEntity(req.user, entityType, entityId);
    const [sheet, legacyNotes] = await Promise.all([
      noteSheets.getSheet(req.user.tenantId, entityType, entityId),
      list(req.user.tenantId, entityType, entityId),
    ]);
    res.json({ sheet, legacyNotes });
  } catch (err) { next(err); }
});

router.put('/sheet', async (req, res, next) => {
  try {
    const parsed = sheetSaveSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors);
    const { entityType, entityId, content, version } = parsed.data;
    await assertEntity(req.user, entityType, entityId);
    const sheet = await noteSheets.saveSheet({ tenantId: req.user.tenantId, userId: req.user.id, entityType, entityId, content, version });
    res.json({ sheet });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors);
    const { entityType, entityId, body } = parsed.data;
    if (SHEET_TYPES.includes(entityType)) throw new ApiError(400, 'Pour un locataire ou un propriétaire, écrivez dans la fiche de notes.');
    await assertEntity(req.user, entityType, entityId);
    await pool.query(
      'INSERT INTO entity_notes (tenant_id, entity_type, entity_id, body, author_id) VALUES (:t, :type, :id, :body, :by)',
      { t: req.user.tenantId, type: entityType, id: entityId, body, by: req.user.id },
    );
    res.status(201).json({ notes: await list(req.user.tenantId, entityType, entityId) });
  } catch (err) { next(err); }
});

module.exports = router;
