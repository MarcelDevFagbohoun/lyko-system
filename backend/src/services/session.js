'use strict';

const { pool } = require('../config/db');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { hashToken } = require('../utils/tokens');
const { msFromDuration } = require('../utils/cookies');
const config = require('../config/env');

/**
 * Émet une paire access/refresh pour un utilisateur et persiste l'empreinte
 * du refresh token en base (nécessaire pour la révocation à la déconnexion
 * et la rotation au rafraîchissement).
 */
async function issueSession(user) {
  const payload = {
    sub: user.id,
    tenantId: user.tenant_id,
    role: user.role,
    mustChangePassword: !!user.must_change_password,
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const expiresAt = new Date(Date.now() + msFromDuration(config.jwt.refreshTtl));
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (:userId, :tokenHash, :expiresAt)',
    { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt },
  );

  return { accessToken, refreshToken };
}

/**
 * Rotation du refresh token : vérifie la signature JWT ET la présence en
 * base (non révoqué, non expiré), révoque l'ancien, en émet un nouveau.
 * Retourne null si le token est invalide à quelque titre que ce soit.
 */
async function rotateRefreshToken(oldToken) {
  let payload;
  try {
    payload = verifyRefreshToken(oldToken);
  } catch (_err) {
    return null;
  }
  void payload; // la vérité vient de la base, pas seulement du JWT (permet la révocation)

  const oldHash = hashToken(oldToken);
  const [rows] = await pool.query(
    'SELECT id, user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = :hash LIMIT 1',
    { hash: oldHash },
  );
  const row = rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) return null;

  const [userRows] = await pool.query(
    `SELECT id, tenant_id, role, first_name, last_name, phone, email, must_change_password, status
     FROM users WHERE id = :id LIMIT 1`,
    { id: row.user_id },
  );
  const user = userRows[0];
  // Filet de sécurité : un compte désactivé entre-temps ne doit plus pouvoir
  // renouveler sa session (au-delà de la révocation déjà faite à la désactivation).
  if (!user || user.status !== 'active') return null;

  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = :id', { id: row.id });
  const session = await issueSession(user);
  return { user, ...session };
}

/** Révoque un refresh token (déconnexion). Idempotent. */
async function revokeRefreshToken(token) {
  const hash = hashToken(token);
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = :hash AND revoked_at IS NULL',
    { hash },
  );
}

module.exports = { issueSession, rotateRefreshToken, revokeRefreshToken };
