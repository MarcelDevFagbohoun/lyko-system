'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const rateLimit = require('express-rate-limit');

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth } = require('../middleware/auth');
const {
  registerSchema,
  loginSchema,
  employeeLoginSchema,
  changePasswordSchema,
  verifyEmailSchema,
  resendVerificationCodeSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require('../validators/auth');
const { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } = require('../utils/password');
const {
  generateEmailVerificationCode,
  hashVerificationCode,
  verifyVerificationCode,
  DUMMY_CODE_HASH,
} = require('../utils/verificationCode');
const { issueSession, rotateRefreshToken, revokeRefreshToken } = require('../services/session');
const { getPermissions } = require('../services/permissions');
const { REFRESH_COOKIE_NAME, refreshCookieOptions } = require('../utils/cookies');
const { assertUploadType, randomFileName, toProtectedFileUrl } = require('../utils/uploads');
const { assertNotLocked, recordFailure, recordSuccess } = require('../middleware/loginThrottle');
const { resolveRoleLabels } = require('../constants/roles');
const { sendVerificationCodeEmail, sendPasswordResetCodeEmail } = require('../services/email/sendEmail');
const logger = require('../utils/logger');

// Code à 8 chiffres (demande utilisateur, 2026-10-18) : expire 15 min après l'envoi, 5 essais
// maximum avant qu'un nouveau code soit requis (voir /verify-email ci-dessous).
const EMAIL_VERIFICATION_TTL_MINUTES = 15;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
// Email de bienvenue (demande utilisateur) : envoyé ~2 minutes après la vérification, via la
// tâche planifiée `jobs/welcomeEmailJob.js` (survit à un redémarrage, contrairement à un minuteur).
const WELCOME_EMAIL_DELAY_MINUTES = 2;

const { createInitialSubscription } = require('../services/entitlements');
const config = require('../config/env');
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

// Vérification d'email (demande utilisateur, 2026-10-18) : quota généreux (code à ressaisir
// plusieurs fois en cas de faute de frappe) mais borné — le plafond d'essais par code
// (`EMAIL_VERIFICATION_MAX_ATTEMPTS`, appliqué en base) reste la défense principale contre le
// brute-force, ce limiteur casse juste un flood pur.
const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard.' },
});

const resendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes de renvoi, réessayez plus tard.' },
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
    jobTitle: user.job_title ?? null,
    permissions,
    // Cachet/signature personnels (apposés sur les quittances des paiements
    // qu'il encaisse lui-même) — jamais ceux de l'entreprise, gérés à part
    // dans Réglages (DG uniquement).
    stampUrl: user.stamp_path ? toProtectedFileUrl(user.stamp_path) : null,
    signatureUrl: user.signature_path ? toProtectedFileUrl(user.signature_path) : null,
    // Photo de profil — purement visuelle dans l'app, jamais sur un document PDF.
    avatarUrl: user.avatar_path ? toProtectedFileUrl(user.avatar_path) : null,
  };
}

function toPublicTenant(tenant) {
  return {
    id: tenant.id,
    companyName: tenant.company_name,
    rccm: tenant.rccm,
    ifu: tenant.ifu,
    contactPhone: tenant.contact_phone,
    // Pays choisi à l'inscription (demande utilisateur, 2026-10-18) — `null` pour toute
    // entreprise inscrite avant cette étape.
    country: tenant.country ?? null,
    logoUrl: tenant.logo_path ? `/uploads/${tenant.logo_path}` : null,
    // Nom des 3 postes chez cette entreprise (Réglages, DG uniquement) —
    // affiché partout (badge, journal, documents), voir constants/roles.js.
    roleTitles: resolveRoleLabels(tenant),
    onlinePaymentEnabled: !!tenant.fedapay_collect_enabled,
    // Convention de paiement du loyer par défaut (avance/terme échu) — sert
    // à pré-remplir le formulaire de création de bail ; réglable par le DG
    // dans Paramètres, mais doit être lisible par TOUT employé qui crée un
    // bail (contrairement à `/api/settings`, réservé au DG).
    defaultRentTiming: tenant.default_rent_timing,
    // Prorata d'entrée par défaut (étape 42) — même raisonnement que `defaultRentTiming` ci-dessus :
    // lisible par tout employé qui crée un bail, réglable par le DG dans Paramètres.
    defaultEntryProration: tenant.default_entry_proration,
    // Cautions supplémentaires activées (étape 43) — même raisonnement : le formulaire de création de
    // bail (tout employé) doit savoir lesquelles proposer, réglable par le DG dans Paramètres.
    depositSbeeEnabled: !!tenant.deposit_sbee_enabled,
    depositSonebEnabled: !!tenant.deposit_soneb_enabled,
    depositPeintureEnabled: !!tenant.deposit_peinture_enabled,
    // Module Charges (SONEB/SBEE) activé pour l'entreprise ? Défini dans Paramètres ; masque menus et écrans si non.
    chargesEnabled: tenant.charges_enabled === undefined ? true : !!tenant.charges_enabled,
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
      country: row.country,
      logo_path: row.logo_path,
      dg_title: row.dg_title,
      comptable_title: row.comptable_title,
      agent_title: row.agent_title,
      fedapay_collect_enabled: row.fedapay_collect_enabled,
      default_rent_timing: row.default_rent_timing,
      default_entry_proration: row.default_entry_proration,
      deposit_sbee_enabled: row.deposit_sbee_enabled,
      deposit_soneb_enabled: row.deposit_soneb_enabled,
      deposit_peinture_enabled: row.deposit_peinture_enabled,
      charges_enabled: row.charges_enabled,
    }),
    accessToken,
  });
}

// POST /api/auth/register — inscription de l'entreprise (section 4.2/4.3). Vérification d'email
// OBLIGATOIRE (demande utilisateur, 2026-10-18) : le compte est créé mais AUCUNE session n'est
// émise ici — contrairement au comportement historique (connexion immédiate) — tant que le code
// à 8 chiffres reçu par email n'a pas été saisi (voir POST /verify-email ci-dessous).
router.post('/register', registerLimiter, upload.single('logo'), async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const [existingPhone] = await conn.query('SELECT id FROM users WHERE phone = :phone LIMIT 1', {
      phone: data.phone,
    });
    if (existingPhone.length > 0) {
      throw new ApiError(409, 'Ce numéro est déjà associé à un compte');
    }
    // Vérification globale (pas seulement par entreprise, contrairement à `uq_users_tenant_email`
    // qui s'applique aux employés) : une inscription crée une entreprise TOUTE NEUVE, donc
    // l'unicité par tenant ne protège de rien ici — sans ce contrôle, la même personne pourrait
    // réinscrire plusieurs cabinets avec le même email, ou deux vérifications en attente
    // partageant un email se mélangeraient. Restreint aux comptes DG : un employé peut très bien
    // partager son email personnel avec l'entreprise qu'il crée par ailleurs.
    const [existingEmail] = await conn.query("SELECT id FROM users WHERE email = :email AND role = 'dg' LIMIT 1", {
      email: data.email,
    });
    if (existingEmail.length > 0) {
      throw new ApiError(409, 'Cet email est déjà associé à un compte administrateur.');
    }

    await conn.beginTransaction();

    const [tenantResult] = await conn.query(
      `INSERT INTO tenants (company_name, rccm, ifu, contact_phone, country, terms_accepted_at, terms_version)
       VALUES (:companyName, :rccm, :ifu, :phone, :country, NOW(), :termsVersion)`,
      { companyName: data.companyName, rccm: data.rccm, ifu: data.ifu, phone: data.phone, country: data.country, termsVersion: config.legal.termsVersion },
    );
    const tenantId = tenantResult.insertId;
    await createInitialSubscription(conn, tenantId);

    const passwordHash = await hashPassword(data.password);
    const code = generateEmailVerificationCode();
    const codeHash = await hashVerificationCode(code);
    const [userResult] = await conn.query(
      `INSERT INTO users
         (tenant_id, first_name, last_name, phone, email, password_hash, role,
          email_verification_code_hash, email_verification_expires_at)
       VALUES
         (:tenantId, :firstName, :lastName, :phone, :email, :passwordHash, 'dg',
          :codeHash, DATE_ADD(NOW(), INTERVAL :ttl MINUTE))`,
      {
        tenantId,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        email: data.email,
        passwordHash,
        codeHash,
        ttl: EMAIL_VERIFICATION_TTL_MINUTES,
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

    // Envoi best-effort (demande utilisateur) : un échec de Resend ne doit jamais faire échouer
    // l'inscription elle-même (le compte/code existent déjà en base, « renvoyer le code » reste
    // toujours possible) — voir le commentaire détaillé dans services/email/sendEmail.js.
    await sendVerificationCodeEmail({ to: data.email, dgName: data.firstName, companyName: data.companyName, code });

    logger.info('Nouvelle entreprise inscrite (vérification d\'email en attente)', { tenantId, userId });
    res.status(201).json({ pendingVerification: true, email: data.email });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

/**
 * Vérifie le code à 8 chiffres et, si valide, termine réellement l'inscription : marque l'email
 * vérifié, programme l'email de bienvenue (~2 min plus tard, voir `jobs/welcomeEmailJob.js`) et
 * ÉMET LA SESSION (seul endroit, avec /login, à le faire) — avant cette étape, aucun token
 * n'existe pour ce compte.
 */
router.post('/verify-email', verifyEmailLimiter, async (req, res, next) => {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { email, code } = parsed.data;

  try {
    const [rows] = await pool.query(
      `SELECT u.*, t.company_name, t.rccm, t.ifu, t.contact_phone, t.country, t.logo_path,
              t.dg_title, t.comptable_title, t.agent_title, t.fedapay_collect_enabled, t.default_rent_timing, t.default_entry_proration,
              t.deposit_sbee_enabled, t.deposit_soneb_enabled, t.deposit_peinture_enabled, t.charges_enabled,
              (u.email_verification_expires_at IS NULL OR u.email_verification_expires_at < NOW()) AS is_expired
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = :email AND u.role = 'dg' AND u.email_verified_at IS NULL LIMIT 1`,
      { email },
    );
    const row = rows[0];
    // Même garde de temporisation que /login (DUMMY_CODE_HASH) : la comparaison s'exécute
    // TOUJOURS, même si aucune vérification en attente ne correspond à cet email.
    const codeOk = await verifyVerificationCode(code, row ? row.email_verification_code_hash : DUMMY_CODE_HASH);
    if (!row) {
      throw new ApiError(400, 'Code invalide ou compte déjà vérifié.');
    }
    if (row.email_verification_attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      throw new ApiError(429, 'Trop de tentatives — demandez un nouveau code.');
    }
    // Bug évité (audit horloge) : comparaison de dates faite ENTIÈREMENT en SQL (`NOW()` des deux
    // côtés), jamais en rapatriant la date en JS pour la comparer à `new Date()` — l'horloge MySQL
    // de ce projet est décalée d'une heure par rapport à l'horloge du serveur Node (voir mémoire
    // projet « DB is WAT but mislabeled UTC »), un mélange des deux aurait rendu ce code JAMAIS
    // expiré en pratique.
    if (row.is_expired) {
      throw new ApiError(400, 'Ce code a expiré — demandez-en un nouveau.');
    }
    if (!codeOk) {
      await pool.query('UPDATE users SET email_verification_attempts = email_verification_attempts + 1 WHERE id = :id', {
        id: row.id,
      });
      throw new ApiError(400, 'Code incorrect.');
    }

    await pool.query(
      `UPDATE users
       SET email_verified_at = NOW(), email_verification_code_hash = NULL, email_verification_expires_at = NULL,
           welcome_email_due_at = DATE_ADD(NOW(), INTERVAL :delay MINUTE)
       WHERE id = :id`,
      { id: row.id, delay: WELCOME_EMAIL_DELAY_MINUTES },
    );

    logger.info('Email vérifié — inscription finalisée', { tenantId: row.tenant_id, userId: row.id });
    await respondWithSession(res, row);
  } catch (err) {
    next(err);
  }
});

/** Renvoie un nouveau code (compte non encore vérifié) — invalide l'ancien, réinitialise les essais. */
router.post('/resend-verification-code', resendCodeLimiter, async (req, res, next) => {
  const parsed = resendVerificationCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { email } = parsed.data;

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.first_name, t.company_name
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = :email AND u.role = 'dg' AND u.email_verified_at IS NULL LIMIT 1`,
      { email },
    );
    const row = rows[0];
    // Réponse générique volontaire (comme /login) : ne révèle jamais si cet email correspond à
    // une inscription en attente.
    if (row) {
      const code = generateEmailVerificationCode();
      const codeHash = await hashVerificationCode(code);
      await pool.query(
        `UPDATE users
         SET email_verification_code_hash = :codeHash,
             email_verification_expires_at = DATE_ADD(NOW(), INTERVAL :ttl MINUTE),
             email_verification_attempts = 0
         WHERE id = :id`,
        { id: row.id, codeHash, ttl: EMAIL_VERIFICATION_TTL_MINUTES },
      );
      await sendVerificationCodeEmail({ to: email, dgName: row.first_name, companyName: row.company_name, code });
      logger.info('Code de vérification renvoyé', { userId: row.id });
    }
    res.json({ message: 'Si un compte en attente existe pour cet email, un nouveau code a été envoyé.' });
  } catch (err) {
    next(err);
  }
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes, réessayez plus tard.' },
});

/**
 * Mot de passe oublié — ADMIN (DG) uniquement : code à 8 chiffres envoyé à son e-mail vérifié (15 min, 5 essais).
 * Réponse toujours identique, que l'e-mail existe ou non. Les employés demandent un nouveau mot de passe temporaire à leur admin.
 */
router.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const { email } = parsed.data;
  try {
    const [rows] = await pool.query(
      "SELECT id, first_name, status FROM users WHERE email = :email AND role = 'dg' AND email_verified_at IS NOT NULL LIMIT 1",
      { email },
    );
    const row = rows[0];
    if (row && row.status === 'active') {
      const code = generateEmailVerificationCode();
      const codeHash = await hashVerificationCode(code);
      await pool.query(
        `UPDATE users SET password_reset_code_hash = :codeHash, password_reset_expires_at = DATE_ADD(NOW(), INTERVAL :ttl MINUTE), password_reset_attempts = 0 WHERE id = :id`,
        { id: row.id, codeHash, ttl: EMAIL_VERIFICATION_TTL_MINUTES },
      );
      await sendPasswordResetCodeEmail({ to: email, dgName: row.first_name, code });
      logger.info('Code de réinitialisation de mot de passe envoyé', { userId: row.id });
    }
    res.json({ message: 'Si un compte administrateur existe pour cet e-mail, un code vient d’y être envoyé.' });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', verifyEmailLimiter, async (req, res, next) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const { email, code, newPassword } = parsed.data;
  try {
    const [rows] = await pool.query(
      `SELECT id, password_reset_code_hash, password_reset_attempts,
              (password_reset_expires_at IS NULL OR password_reset_expires_at < NOW()) AS is_expired
       FROM users WHERE email = :email AND role = 'dg' AND email_verified_at IS NOT NULL LIMIT 1`,
      { email },
    );
    const row = rows[0];
    // La comparaison s'exécute toujours (temporisation constante), même sans demande en cours.
    const codeOk = await verifyVerificationCode(code, row?.password_reset_code_hash || DUMMY_CODE_HASH);
    const generic = 'Code invalide ou expiré — demandez-en un nouveau.';
    if (!row || !row.password_reset_code_hash) throw new ApiError(400, generic);
    if (row.password_reset_attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) throw new ApiError(429, 'Trop de tentatives — demandez un nouveau code.');
    if (row.is_expired) throw new ApiError(400, generic);
    if (!codeOk) {
      await pool.query('UPDATE users SET password_reset_attempts = password_reset_attempts + 1 WHERE id = :id', { id: row.id });
      throw new ApiError(400, 'Code incorrect.');
    }
    const hash = await hashPassword(newPassword);
    await pool.query(
      `UPDATE users SET password_hash = :hash, must_change_password = 0,
         password_reset_code_hash = NULL, password_reset_expires_at = NULL, password_reset_attempts = 0
       WHERE id = :id`,
      { hash, id: row.id },
    );
    // Toutes les sessions ouvertes sont fermées : un appareil qui connaissait l'ancien mot de passe est déconnecté.
    await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = :id AND revoked_at IS NULL', { id: row.id });
    logger.info('Mot de passe admin réinitialisé', { userId: row.id });
    res.json({ message: 'Mot de passe modifié. Vous pouvez vous connecter.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login — porte Admin (DG), par numéro de téléphone.
router.post('/login', loginLimiter, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { phone, password } = parsed.data; // `phone` peut être un numéro OU un e-mail
  const byEmail = phone.includes('@');
  const throttleKey = `phone:${phone}`;

  try {
    await assertNotLocked(throttleKey);

    const [rows] = await pool.query(
      `SELECT u.*, t.company_name, t.rccm, t.ifu, t.contact_phone, t.country, t.logo_path,
              t.dg_title, t.comptable_title, t.agent_title, t.fedapay_collect_enabled, t.default_rent_timing, t.default_entry_proration,
              t.deposit_sbee_enabled, t.deposit_soneb_enabled, t.deposit_peinture_enabled, t.charges_enabled
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE ${byEmail ? "u.email = :phone AND u.role = 'dg'" : 'u.phone = :phone'} LIMIT 1`,
      { phone },
    );
    const row = rows[0];
    // Message générique volontaire : ne révèle pas si le numéro existe. Le
    // `bcrypt.compare` s'exécute TOUJOURS (contre un hash factice si `row`
    // n'existe pas) pour que le temps de réponse ne le révèle pas non plus
    // (audit sécurité — sans ça, un identifiant inconnu répondait plus vite).
    const passwordOk = await verifyPassword(password, row ? row.password_hash : DUMMY_PASSWORD_HASH);
    if (!row || !passwordOk) {
      await recordFailure(throttleKey);
      throw new ApiError(401, 'Identifiants incorrects (numéro, e-mail ou mot de passe).');
    }
    if (row.role !== 'dg') {
      throw new ApiError(401, 'Ce compte se connecte depuis « Connexion employé ».');
    }
    if (row.status !== 'active') {
      throw new ApiError(403, 'Ce compte a été désactivé. Contactez votre direction.');
    }
    // Vérification d'email obligatoire (demande utilisateur, 2026-10-18) : un DG dont
    // l'inscription n'a jamais été confirmée ne doit JAMAIS pouvoir se connecter, même avec le
    // bon mot de passe — `details.code`/`details.email` permettent au frontend de rediriger
    // directement vers l'écran de saisie du code plutôt qu'une simple erreur sans suite.
    if (!row.email_verified_at) {
      throw new ApiError(403, "Email non confirmé — saisissez le code reçu par email.", {
        code: ['email_not_verified'],
        email: [row.email],
      });
    }

    await recordSuccess(throttleKey);
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
    await assertNotLocked(throttleKey);

    const [rows] = await pool.query(
      `SELECT u.*, t.company_name, t.rccm, t.ifu, t.contact_phone, t.country, t.logo_path,
              t.dg_title, t.comptable_title, t.agent_title, t.fedapay_collect_enabled, t.default_rent_timing, t.default_entry_proration,
              t.deposit_sbee_enabled, t.deposit_soneb_enabled, t.deposit_peinture_enabled, t.charges_enabled
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
    if (!row || !passwordOk || row.role === 'dg' || (role && row.role !== role)) {
      await recordFailure(throttleKey);
      throw new ApiError(401, 'Identifiant ou mot de passe incorrect');
    }
    if (row.status !== 'active') {
      throw new ApiError(403, 'Ce compte a été désactivé. Contactez votre direction.');
    }

    await recordSuccess(throttleKey);
    await respondWithSession(res, row);
  } catch (err) {
    next(err);
  }
});

// Audit du 2026-10-23 : seule route GET de ce fichier sans limiteur, contrairement à toutes les
// autres (login, mot de passe oublié...) qui protègent un signal comparable. Le signal ici est
// faible (la réponse ne diffère de la version « par défaut » que si l'entreprise correspondante a
// personnalisé ses intitulés de poste — une minorité), mais une énumération libre et illimitée
// d'identifiants/numéros reste à fermer par principe. Quota généreux (30/15min) : le formulaire
// n'appelle cette route qu'une fois par pause de frappe (350 ms de debounce, voir
// `unified-login-form.tsx`), donc un vrai utilisateur ne l'atteint jamais ; en cas de 429, le
// frontend retombe silencieusement sur les libellés par défaut (jamais bloquant).
const roleTitlesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});

// GET /api/auth/role-titles?identifier=XXXX  (employé)  ou  ?phone=XXXX  (DG)
// — libellés des 3 postes personnalisés (Réglages) de l'entreprise
// correspondante, pour le menu déroulant unique « Poste » À LA CONNEXION —
// l'utilisateur n'a encore donné que son identifiant/numéro à ce stade,
// jamais authentifié. Toujours une réponse (jamais 404) : les libellés par
// défaut si rien ne correspond ou si aucun des deux paramètres n'est
// fourni, pour ne jamais permettre de deviner si un identifiant/numéro
// existe (même principe que le message de connexion générique ci-dessus).
router.get('/role-titles', roleTitlesLimiter, async (req, res, next) => {
  try {
    const identifier = typeof req.query.identifier === 'string' ? req.query.identifier.trim() : '';
    const phone = typeof req.query.phone === 'string' ? req.query.phone.trim() : '';
    let tenant = null;
    if (identifier) {
      const [rows] = await pool.query(
        `SELECT t.dg_title, t.comptable_title, t.agent_title
         FROM users u JOIN tenants t ON t.id = u.tenant_id
         WHERE u.identifier = :identifier LIMIT 1`,
        { identifier },
      );
      tenant = rows[0] || null;
    } else if (phone) {
      const [rows] = await pool.query(
        `SELECT t.dg_title, t.comptable_title, t.agent_title
         FROM users u JOIN tenants t ON t.id = u.tenant_id
         WHERE ${phone.includes('@') ? "u.email = :phone AND u.role = 'dg'" : 'u.phone = :phone'} LIMIT 1`,
        { phone: phone.includes('@') ? phone.toLowerCase() : phone },
      );
      tenant = rows[0] || null;
    }
    res.json(resolveRoleLabels(tenant));
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
      `SELECT u.*, t.company_name, t.rccm, t.ifu, t.contact_phone, t.country, t.logo_path,
              t.dg_title, t.comptable_title, t.agent_title, t.fedapay_collect_enabled, t.default_rent_timing, t.default_entry_proration,
              t.deposit_sbee_enabled, t.deposit_soneb_enabled, t.deposit_peinture_enabled, t.charges_enabled
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
        country: row.country,
        logo_path: row.logo_path,
        dg_title: row.dg_title,
        comptable_title: row.comptable_title,
        agent_title: row.agent_title,
        default_rent_timing: row.default_rent_timing,
        default_entry_proration: row.default_entry_proration,
        deposit_sbee_enabled: row.deposit_sbee_enabled,
        deposit_soneb_enabled: row.deposit_soneb_enabled,
        deposit_peinture_enabled: row.deposit_peinture_enabled,
      charges_enabled: row.charges_enabled,
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

// PATCH /api/auth/my-profile — photo de profil, cachet et signature
// personnels (n'importe quel employé, pas seulement le DG : c'est celui qui
// encaisse un loyer qui doit pouvoir apposer son propre cachet/signature —
// voir services/pdf.js `streamReceiptPdf`). À défaut, la quittance retombe
// sur le cachet/signature de l'entreprise. La photo, elle, est purement
// visuelle dans l'app — jamais sur un document PDF.
router.patch(
  '/my-profile',
  requireAuth,
  upload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'stamp', maxCount: 1 },
    { name: 'signature', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const avatarFile = req.files?.avatar?.[0];
      const stampFile = req.files?.stamp?.[0];
      const signatureFile = req.files?.signature?.[0];
      // Suppression sans retéléverser (demande utilisateur, 2026-10-30) : un nouveau fichier pour un
      // champ prévaut toujours sur une demande de suppression du même champ.
      const removeAvatar = req.body?.removeAvatar === 'true' && !avatarFile;
      const removeStamp = req.body?.removeStamp === 'true' && !stampFile;
      const removeSignature = req.body?.removeSignature === 'true' && !signatureFile;
      if (!avatarFile && !stampFile && !signatureFile && !removeAvatar && !removeStamp && !removeSignature) {
        throw new ApiError(400, 'Aucun fichier reçu');
      }

      const oldPaths = [];
      const dir = path.join(UPLOADS_ROOT, `tenants/${req.user.tenantId}/employees/${req.user.id}`);
      await fs.mkdir(dir, { recursive: true });
      const [[current]] = await pool.query(
        'SELECT avatar_path, stamp_path, signature_path FROM users WHERE id = :id LIMIT 1',
        { id: req.user.id },
      );

      const fields = [];
      const params = { id: req.user.id };
      if (avatarFile) {
        if (current?.avatar_path) oldPaths.push(current.avatar_path);
        const ext = assertUploadType(avatarFile, { label: 'Photo de profil' });
        const rel = `tenants/${req.user.tenantId}/employees/${req.user.id}/${randomFileName('avatar', ext)}`;
        await fs.writeFile(path.join(UPLOADS_ROOT, rel), avatarFile.buffer);
        fields.push('avatar_path = :avatarPath');
        params.avatarPath = rel;
      } else if (removeAvatar) {
        if (current?.avatar_path) oldPaths.push(current.avatar_path);
        fields.push('avatar_path = NULL');
      }
      if (stampFile) {
        if (current?.stamp_path) oldPaths.push(current.stamp_path);
        const ext = assertUploadType(stampFile, { label: 'Cachet' });
        const rel = `tenants/${req.user.tenantId}/employees/${req.user.id}/${randomFileName('stamp', ext)}`;
        await fs.writeFile(path.join(UPLOADS_ROOT, rel), stampFile.buffer);
        fields.push('stamp_path = :stampPath');
        params.stampPath = rel;
      } else if (removeStamp) {
        if (current?.stamp_path) oldPaths.push(current.stamp_path);
        fields.push('stamp_path = NULL');
      }
      if (signatureFile) {
        if (current?.signature_path) oldPaths.push(current.signature_path);
        const ext = assertUploadType(signatureFile, { label: 'Signature' });
        const rel = `tenants/${req.user.tenantId}/employees/${req.user.id}/${randomFileName('signature', ext)}`;
        await fs.writeFile(path.join(UPLOADS_ROOT, rel), signatureFile.buffer);
        fields.push('signature_path = :signaturePath');
        params.signaturePath = rel;
      } else if (removeSignature) {
        if (current?.signature_path) oldPaths.push(current.signature_path);
        fields.push('signature_path = NULL');
      }

      if (fields.length > 0) {
        await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = :id`, params);
      }
      await Promise.all(oldPaths.map((rel) => fs.unlink(path.join(UPLOADS_ROOT, rel)).catch(() => {})));

      const [rows] = await pool.query('SELECT * FROM users WHERE id = :id LIMIT 1', { id: req.user.id });
      logger.info('Profil personnel mis à jour (photo/cachet/signature)', { tenantId: req.user.tenantId, userId: req.user.id });
      res.json({ user: toPublicUser(rows[0]) });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
