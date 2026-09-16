'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const rateLimit = require('express-rate-limit');

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth } = require('../middleware/auth');
const { registerSchema, loginSchema, employeeLoginSchema, changePasswordSchema } = require('../validators/auth');
const { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } = require('../utils/password');
const { issueSession, rotateRefreshToken, revokeRefreshToken } = require('../services/session');
const { getPermissions } = require('../services/permissions');
const { REFRESH_COOKIE_NAME, refreshCookieOptions } = require('../utils/cookies');
const { assertUploadType, randomFileName } = require('../utils/uploads');
const { assertNotLocked, recordFailure, recordSuccess } = require('../middleware/loginThrottle');
const logger = require('../utils/logger');

const router = Router();

/**
 * Limiteurs dédiés, plus stricts que le limiteur global (protègent contre le
 * brute-force). Durcis à l'étape 12 :
 *  - connexion : `skipSuccessfulRequests` — seuls les échecs comptent, pour
 *    qu'un cabinet entier (une seule IP publique) puisse se connecter le matin
 *    sans épuiser le quota ;
 *  - un compteur distinct par usage (connexion / inscription / changement de
 *    mot de passe) plutôt qu'un seul quota partagé.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion, réessayez plus tard.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de demandes d'inscription, réessayez plus tard." },
});

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard.' },
});

// Le SPA rafraîchit l'access token à chaque chargement et à chaque 401 (et
// une fois par onglet ouvert) : quota large, il ne sert qu'à casser un flood.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new ApiError(400, 'Logo : formats acceptés PNG, JPEG, WEBP (2 Mo max)'));
    }
    cb(null, true);
  },
});

function toPublicUser(user, { permissions = [], mustChangePassword } = {}) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    phone: user.phone,
    identifier: user.identifier ?? null,
    email: user.email,
    role: user.role,
    mustChangePassword: !!(mustChangePassword ?? user.must_change_password),
    permissions,
  };
}

function toPublicTenant(tenant) {
  return {
    id: tenant.id,
    companyName: tenant.company_name,
    rccm: tenant.rccm,
    ifu: tenant.ifu,
    contactPhone: tenant.contact_phone,
    logoUrl: tenant.logo_path ? `/uploads/${tenant.logo_path}` : null,
  };
}

/** Termine une connexion réussie : session JWT + cookie + réponse JSON commune. */
async function respondWithSession(res, row) {
  const { accessToken, refreshToken } = await issueSession(row);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());

  const permissions = await getPermissions(row.id, row.role);
  res.json({
    user: toPublicUser(row, { permissions }),
    tenant: toPublicTenant({
      id: row.tenant_id,
      company_name: row.company_name,
      rccm: row.rccm,
      ifu: row.ifu,
      contact_phone: row.contact_phone,
      logo_path: row.logo_path,
    }),
    accessToken,
  });
}

// POST /api/auth/register — inscription de l'entreprise (section 4.2/4.3).
router.post('/register', registerLimiter, upload.single('logo'), async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query('SELECT id FROM users WHERE phone = :phone LIMIT 1', {
      phone: data.phone,
    });
    if (existing.length > 0) {
      throw new ApiError(409, 'Ce numéro est déjà associé à un compte');
    }

    await conn.beginTransaction();

    const [tenantResult] = await conn.query(
      `INSERT INTO tenants (company_name, rccm, ifu, contact_phone)
       VALUES (:companyName, :rccm, :ifu, :phone)`,
      { companyName: data.companyName, rccm: data.rccm, ifu: data.ifu, phone: data.phone },
    );
    const tenantId = tenantResult.insertId;

    const passwordHash = await hashPassword(data.password);
    const [userResult] = await conn.query(
      `INSERT INTO users (tenant_id, first_name, last_name, phone, password_hash, role)
       VALUES (:tenantId, :firstName, :lastName, :phone, :passwordHash, 'dg')`,
      {
        tenantId,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        passwordHash,
      },
    );
    const userId = userResult.insertId;

    let logoPath = null;
    if (req.file) {
      const ext = assertUploadType(req.file, { label: 'Logo' }); // contenu réel, pas le MIME déclaré
      logoPath = `tenants/${tenantId}/${randomFileName('logo', ext)}`; // nom non énumérable
      const dir = path.join(UPLOADS_ROOT, `tenants/${tenantId}`);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(UPLOADS_ROOT, logoPath), req.file.buffer);
      await conn.query('UPDATE tenants SET logo_path = :logoPath WHERE id = :id', {
        logoPath,
        id: tenantId,
      });
    }

    await conn.commit();

    const user = {
      id: userId,
      tenant_id: tenantId,
      role: 'dg',
      first_name: data.firstName,
      last_name: data.lastName,
      phone: data.phone,
      email: null,
      must_change_password: 0,
    };
    const tenant = {
      id: tenantId,
      company_name: data.companyName,
      rccm: data.rccm,
      ifu: data.ifu,
      contact_phone: data.phone,
      logo_path: logoPath,
    };

    const { accessToken, refreshToken } = await issueSession(user);
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());

    logger.info('Nouvelle entreprise inscrite', { tenantId, userId });
    res.status(201).json({ user: toPublicUser(user), tenant: toPublicTenant(tenant), accessToken });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// POST /api/auth/login — porte Admin (DG), par numéro de téléphone.
router.post('/login', loginLimiter, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { phone, password } = parsed.data;
  const throttleKey = `phone:${phone}`;

  try {
    assertNotLocked(throttleKey);

    const [rows] = await pool.query(
      `SELECT u.*, t.company_name, t.rccm, t.ifu, t.contact_phone, t.logo_path
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.phone = :phone LIMIT 1`,
      { phone },
    );
    const row = rows[0];
    // Message générique volontaire : ne révèle pas si le numéro existe. Le
    // `bcrypt.compare` s'exécute TOUJOURS (contre un hash factice si `row`
    // n'existe pas) pour que le temps de réponse ne le révèle pas non plus
    // (audit sécurité — sans ça, un identifiant inconnu répondait plus vite).
    const passwordOk = await verifyPassword(password, row ? row.password_hash : DUMMY_PASSWORD_HASH);
    if (!row || !passwordOk) {
      recordFailure(throttleKey);
      throw new ApiError(401, 'Numéro ou mot de passe incorrect');
    }
    if (row.role !== 'dg') {
      throw new ApiError(401, 'Ce compte se connecte depuis « Connexion employé ».');
    }
    if (row.status !== 'active') {
      throw new ApiError(403, 'Ce compte a été désactivé. Contactez votre direction.');
    }

    recordSuccess(throttleKey);
    await respondWithSession(res, row);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login-employee — porte Employé, par identifiant + poste + mot de passe.
router.post('/login-employee', loginLimiter, async (req, res, next) => {
  const parsed = employeeLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { identifier, role, password } = parsed.data;
  const throttleKey = `id:${identifier}`;

  try {
    assertNotLocked(throttleKey);

    const [rows] = await pool.query(
      `SELECT u.*, t.company_name, t.rccm, t.ifu, t.contact_phone, t.logo_path
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.identifier = :identifier LIMIT 1`,
      { identifier },
    );
    const row = rows[0];
    // Message générique volontaire : ne révèle pas si l'identifiant existe,
    // ni si c'est le mot de passe ou le poste qui ne correspond pas. Même
    // garde de temporisation que /login ci-dessus (hash factice si `row`
    // n'existe pas).
    const passwordOk = await verifyPassword(password, row ? row.password_hash : DUMMY_PASSWORD_HASH);
    if (!row || !passwordOk || row.role !== role) {
      recordFailure(throttleKey);
      throw new ApiError(401, 'Identifiant, poste ou mot de passe incorrect');
    }
    if (row.status !== 'active') {
      throw new ApiError(403, 'Ce compte a été désactivé. Contactez votre direction.');
    }

    recordSuccess(throttleKey);
    await respondWithSession(res, row);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh — rotation du refresh token, nouvel access token.
router.post('/refresh', refreshLimiter, async (req, res, next) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) return next(new ApiError(401, 'Session absente'));

  try {
    const result = await rotateRefreshToken(token);
    if (!result) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      throw new ApiError(401, 'Session expirée, reconnectez-vous');
    }
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
    res.json({ accessToken: result.accessToken });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res, next) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  try {
    if (token) await revokeRefreshToken(token);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — restaure la session (logo, entreprise, utilisateur) après rechargement.
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.*, t.company_name, t.rccm, t.ifu, t.contact_phone, t.logo_path
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = :id LIMIT 1`,
      { id: req.user.id },
    );
    const row = rows[0];
    if (!row) throw new ApiError(404, 'Utilisateur introuvable');
    const permissions = await getPermissions(row.id, row.role);
    res.json({
      user: toPublicUser(row, { permissions }),
      tenant: toPublicTenant({
        id: row.tenant_id,
        company_name: row.company_name,
        rccm: row.rccm,
        ifu: row.ifu,
        contact_phone: row.contact_phone,
        logo_path: row.logo_path,
      }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/change-password — auto-service ; sert aussi au changement
// obligatoire du mot de passe temporaire à la première connexion (étape 3).
router.post('/change-password', requireAuth, changePasswordLimiter, async (req, res, next) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { currentPassword, newPassword } = parsed.data;

  try {
    const [rows] = await pool.query('SELECT id, password_hash FROM users WHERE id = :id LIMIT 1', {
      id: req.user.id,
    });
    const user = rows[0];
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      throw new ApiError(401, 'Mot de passe actuel incorrect');
    }

    const newHash = await hashPassword(newPassword);
    await pool.query(
      'UPDATE users SET password_hash = :hash, must_change_password = 0 WHERE id = :id',
      { hash: newHash, id: user.id },
    );

    logger.info('Mot de passe changé', { userId: user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
