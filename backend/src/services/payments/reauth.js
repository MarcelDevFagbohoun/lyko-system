'use strict';

const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { verifyPassword, DUMMY_PASSWORD_HASH } = require('../../utils/password');

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

/**
 * Re-saisie du mot de passe avant toute opération d'envoi d'argent. Message volontairement unique et générique
 * (jamais « mot de passe incorrect » vs « compte inconnu »), bcrypt exécuté dans tous les cas (temps constant),
 * verrouillage de 15 minutes après 5 échecs consécutifs.
 */
async function assertPasswordReauth(userId, password) {
  const [[state]] = await pool.query('SELECT failed_count, locked_until FROM payment_reauth_state WHERE user_id = :userId', { userId });
  if (state?.locked_until && new Date(state.locked_until) > new Date()) {
    throw new ApiError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  }
  const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id = :userId', { userId });
  const ok = await verifyPassword(typeof password === 'string' ? password : '', user ? user.password_hash : DUMMY_PASSWORD_HASH);
  if (!ok || !user) {
    const failed = (state?.failed_count ?? 0) + 1;
    const lock = failed >= MAX_FAILURES;
    await pool.query(
      `INSERT INTO payment_reauth_state (user_id, failed_count, locked_until)
       VALUES (:userId, :failed, ${lock ? 'DATE_ADD(NOW(), INTERVAL :mins MINUTE)' : 'NULL'})
       ON DUPLICATE KEY UPDATE failed_count = :failed, locked_until = ${lock ? 'DATE_ADD(NOW(), INTERVAL :mins MINUTE)' : 'NULL'}`,
      { userId, failed: lock ? 0 : failed, mins: LOCK_MINUTES },
    );
    throw new ApiError(403, 'Confirmation refusée.');
  }
  if (state) await pool.query('UPDATE payment_reauth_state SET failed_count = 0, locked_until = NULL WHERE user_id = :userId', { userId });
}

module.exports = { assertPasswordReauth, MAX_FAILURES, LOCK_MINUTES };
