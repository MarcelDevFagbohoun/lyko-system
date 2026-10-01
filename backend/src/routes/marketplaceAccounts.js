'use strict';

// Comptes du grand public sur Quick Immo (site externe séparé, relié à
// cette plateforme) : chercheurs de logement et propriétaires qui
// s'inscrivent eux-mêmes — realm totalement distinct des employés
// (routes/auth.js) et des locataires/propriétaires déjà connus du cabinet
// (portails à lien secret). Pas de rotation de refresh token ici (voir
// utils/jwt.js `signMarketplaceToken`) : un simple access token longue
// durée, proportionné à l'absence d'enjeu financier/sensible comparable.

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireMarketplaceAccount, requireAccountRole } = require('../middleware/marketplaceAccountAuth');
const { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } = require('../utils/password');
const { signMarketplaceToken } = require('../utils/jwt');
const {
  registerAccountSchema,
  loginAccountSchema,
  createRequestSchema,
} = require('../validators/marketplaceAccounts');
const logger = require('../utils/logger');

const router = Router();

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de demandes d'inscription, réessayez plus tard." },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion, réessayez plus tard.' },
});

function toPublicAccount(row) {
  return {
    id: row.id,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
  };
}

function issueToken(row) {
  return signMarketplaceToken({ sub: row.id, tenantId: row.tenant_id, role: row.role });
}

// POST /api/marketplace-accounts/register
router.post('/register', registerLimiter, async (req, res, next) => {
  const parsed = registerAccountSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const data = parsed.data;

  try {
    const [tenantRows] = await pool.query('SELECT id FROM tenants WHERE id = :id LIMIT 1', { id: data.tenantId });
    if (!tenantRows[0]) throw new ApiError(404, 'Cabinet introuvable');

    const [existing] = await pool.query(
      'SELECT id FROM marketplace_accounts WHERE tenant_id = :tenantId AND phone = :phone LIMIT 1',
      { tenantId: data.tenantId, phone: data.phone },
    );
    if (existing[0]) throw new ApiError(409, 'Un compte existe déjà avec ce numéro.');

    const passwordHash = await hashPassword(data.password);
    const [result] = await pool.query(
      `INSERT INTO marketplace_accounts (tenant_id, role, first_name, last_name, phone, password_hash)
       VALUES (:tenantId, :role, :firstName, :lastName, :phone, :passwordHash)`,
      { ...data, passwordHash },
    );

    const [rows] = await pool.query('SELECT * FROM marketplace_accounts WHERE id = :id', { id: result.insertId });
    logger.info('Compte Quick Immo créé', { tenantId: data.tenantId, accountId: result.insertId, role: data.role });
    res.status(201).json({ account: toPublicAccount(rows[0]), accessToken: issueToken(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/marketplace-accounts/login
router.post('/login', loginLimiter, async (req, res, next) => {
  const parsed = loginAccountSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const { tenantId, phone, password } = parsed.data;

  try {
    const [rows] = await pool.query(
      'SELECT * FROM marketplace_accounts WHERE tenant_id = :tenantId AND phone = :phone LIMIT 1',
      { tenantId, phone },
    );
    // Message générique volontairement identique dans les deux cas (compte
    // inconnu / mot de passe erroné) — jamais confirmer qu'un numéro existe.
    // `bcrypt.compare` s'exécute toujours (hash factice sinon) pour que le
    // temps de réponse ne le révèle pas non plus (audit sécurité).
    const passwordOk = await verifyPassword(password, rows[0] ? rows[0].password_hash : DUMMY_PASSWORD_HASH);
    if (!rows[0] || !passwordOk) {
      throw new ApiError(401, 'Numéro ou mot de passe incorrect');
    }
    res.json({ account: toPublicAccount(rows[0]), accessToken: issueToken(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// GET /api/marketplace-accounts/me
router.get('/me', requireMarketplaceAccount, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM marketplace_accounts WHERE id = :id LIMIT 1', {
      id: req.account.id,
    });
    if (!rows[0]) throw new ApiError(404, 'Compte introuvable');
    res.json({ account: toPublicAccount(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/marketplace-accounts/requests — « Confier un bien » (propriétaire uniquement).
router.post('/requests', requireMarketplaceAccount, requireAccountRole('proprietaire'), async (req, res, next) => {
  const parsed = createRequestSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const data = parsed.data;

  try {
    const [result] = await pool.query(
      `INSERT INTO marketplace_requests (tenant_id, account_id, request_type, address, description)
       VALUES (:tenantId, :accountId, :requestType, :address, :description)`,
      { tenantId: req.account.tenantId, accountId: req.account.id, ...data },
    );
    logger.info('Demande « confier un bien » créée', {
      tenantId: req.account.tenantId,
      accountId: req.account.id,
      requestId: result.insertId,
    });
    res.status(201).json({ requestId: result.insertId });
  } catch (err) {
    next(err);
  }
});

// GET /api/marketplace-accounts/requests/mine — mes demandes + leur statut.
router.get(
  '/requests/mine',
  requireMarketplaceAccount,
  requireAccountRole('proprietaire'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, request_type, address, description, status, created_at
         FROM marketplace_requests WHERE account_id = :accountId ORDER BY created_at DESC`,
        { accountId: req.account.id },
      );
      res.json({
        requests: rows.map((r) => ({
          id: r.id,
          requestType: r.request_type,
          address: r.address,
          description: r.description,
          status: r.status,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- Favoris (chercheur uniquement) ---------------------------------------

// GET /api/marketplace-accounts/favorites
router.get('/favorites', requireMarketplaceAccount, requireAccountRole('chercheur'), async (req, res, next) => {
  try {
    // Bug de sécurité corrigé (audit) : sans le filtre tenant_id ci-dessous,
    // un favori pointant vers l'unité d'une AUTRE entreprise (voir le garde
    // posé sur POST ci-dessous) aurait tout de même pu remonter ses données
    // ici — défense en profondeur même si POST empêche désormais d'en créer.
    const [rows] = await pool.query(
      `SELECT u.id AS unit_id, u.code AS unit_code, u.designation, u.designation_custom,
              u.monthly_rent, u.furnished, u.status,
              p.code AS property_code, p.address, p.property_type,
              ml.description, ml.photo_paths
       FROM marketplace_favorites f
       JOIN property_units u ON u.id = f.unit_id AND u.tenant_id = :tenantId
       JOIN properties p ON p.id = u.property_id
       LEFT JOIN marketplace_listings ml ON ml.unit_id = u.id
       WHERE f.account_id = :accountId
       ORDER BY f.created_at DESC`,
      { accountId: req.account.id, tenantId: req.account.tenantId },
    );
    res.json({
      favorites: rows.map((r) => ({
        unitId: r.unit_id,
        unitCode: r.unit_code,
        designation: r.designation,
        designationCustom: r.designation_custom,
        monthlyRent: Number(r.monthly_rent),
        furnished: !!r.furnished,
        stillAvailable: r.status === 'libre',
        propertyCode: r.property_code,
        address: r.address,
        propertyType: r.property_type,
        description: r.description,
        photoUrls: (r.photo_paths || []).map((p) => `/uploads/${p}`),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/marketplace-accounts/favorites/:unitId
// Bug de sécurité corrigé (audit) : rien ne vérifiait que `unitId` appartient
// à l'entreprise (tenant) du compte, ni même qu'il s'agit d'une annonce
// publiée — un compte pouvait « favoriser » (puis lire via GET ci-dessus)
// n'importe quelle unité de n'importe quelle entreprise, publiée ou non,
// juste en devinant un id séquentiel. Exigeant désormais une annonce
// publiée pour CE tenant précis — même condition que la page publique
// (`GET /public/:tenantId`).
router.post('/favorites/:unitId', requireMarketplaceAccount, requireAccountRole('chercheur'), async (req, res, next) => {
  const unitId = Number(req.params.unitId);
  if (!Number.isInteger(unitId)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const [listed] = await pool.query(
      `SELECT 1 FROM marketplace_listings ml
       JOIN property_units u ON u.id = ml.unit_id
       WHERE ml.unit_id = :unitId AND u.tenant_id = :tenantId LIMIT 1`,
      { unitId, tenantId: req.account.tenantId },
    );
    if (!listed[0]) throw new ApiError(404, 'Annonce introuvable');

    await pool.query(
      'INSERT IGNORE INTO marketplace_favorites (account_id, unit_id) VALUES (:accountId, :unitId)',
      { accountId: req.account.id, unitId },
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/marketplace-accounts/favorites/:unitId
router.delete('/favorites/:unitId', requireMarketplaceAccount, requireAccountRole('chercheur'), async (req, res, next) => {
  const unitId = Number(req.params.unitId);
  if (!Number.isInteger(unitId)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    // `account_id` seul suffit déjà à ne retirer QUE ses propres favoris (aucune fuite possible ici),
    // mais un favori créé avant le correctif ci-dessus pouvait pointer vers une autre entreprise —
    // ce garde permet de le retirer normalement sans jamais avoir besoin de le lire au préalable.
    await pool.query(
      `DELETE f FROM marketplace_favorites f
       JOIN property_units u ON u.id = f.unit_id
       WHERE f.account_id = :accountId AND f.unit_id = :unitId AND u.tenant_id = :tenantId`,
      { accountId: req.account.id, unitId, tenantId: req.account.tenantId },
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
