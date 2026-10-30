'use strict';

const { pool } = require('../config/db');
const { ApiError } = require('./error');

/**
 * Étape 12 (audit sécurité) — ralentisseur d'attaque par compte, en plus du
 * limiteur par IP (`authLimiter`, routes/auth.js).
 *
 * Motif : un cabinet accède à Internet derrière une seule IP publique (NAT).
 * Le limiteur par IP protège donc mal contre un attaquant qui cible un compte
 * précis depuis cette même IP (ou qui répartit ses tentatives sur plusieurs
 * IP). On compte ici les échecs *par identifiant* (téléphone du DG, ou
 * identifiant employé) et on bloque cet identifiant pendant un court palier
 * après trop d'échecs rapprochés.
 *
 * Choix assumés :
 *  - Palier court (15 min), pas de verrouillage long : un attaquant peut
 *    provoquer un blocage temporaire du compte visé (déni de service ciblé),
 *    mais 8 essais / 15 min rend le brute-force d'un mot de passe conforme
 *    (10+ car., 4 classes — validators/auth.js) totalement irréaliste. Le
 *    compromis penche du bon côté.
 *
 * Révision (audit sécurité, 2026-10-30, point 6) : persisté dans la table
 * `login_throttle` (migration 134), plus seulement en mémoire du process —
 * un redémarrage/déploiement ne remet plus un compte en cours de blocage à
 * zéro, et plusieurs instances derrière un load-balancer partagent le même
 * compteur (une seule base). Les fonctions exposées gardent exactement la
 * même signature logique qu'avant (désormais asynchrones) : aucun appelant
 * n'a besoin de connaître ce détail d'implémentation.
 */

const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

/** Lève une 429 si l'identifiant est actuellement bloqué. À appeler avant de vérifier le mot de passe. */
async function assertNotLocked(key) {
  const [rows] = await pool.query('SELECT locked_until FROM login_throttle WHERE throttle_key = :key LIMIT 1', { key });
  const lockedUntil = rows[0]?.locked_until;
  if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
    const minutes = Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60000);
    throw new ApiError(429, `Trop de tentatives sur ce compte. Réessayez dans ${minutes} min.`);
  }
}

/** Enregistre un échec d'authentification pour cet identifiant ; arme le blocage au seuil atteint. */
async function recordFailure(key) {
  const now = new Date();
  const [rows] = await pool.query(
    'SELECT failures, window_started_at FROM login_throttle WHERE throttle_key = :key LIMIT 1',
    { key },
  );
  const existing = rows[0];
  const windowExpired = !existing?.window_started_at || now.getTime() - new Date(existing.window_started_at).getTime() >= WINDOW_MS;
  const failures = windowExpired ? 1 : existing.failures + 1;
  const windowStartedAt = windowExpired ? now : existing.window_started_at;
  const lockedUntil = failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS) : null;

  await pool.query(
    `INSERT INTO login_throttle (throttle_key, failures, window_started_at, locked_until)
     VALUES (:key, :failures, :windowStartedAt, :lockedUntil)
     ON DUPLICATE KEY UPDATE failures = :failures, window_started_at = :windowStartedAt, locked_until = :lockedUntil`,
    { key, failures: lockedUntil ? 0 : failures, windowStartedAt, lockedUntil },
  );

  // Purge opportuniste (pas de job dédié pour une table de compteurs courts) : à chaque verrouillage posé,
  // une chance sur 20 d'évacuer les anciennes entrées expirées pour que la table ne grossisse pas sans fin
  // (énumération d'identifiants inconnus comprise — voir le commentaire de la migration).
  if (lockedUntil && Math.random() < 0.05) {
    await pool
      .query('DELETE FROM login_throttle WHERE locked_until IS NOT NULL AND locked_until < NOW() - INTERVAL 1 DAY')
      .catch(() => {});
  }
}

/** Réinitialise le compteur après une connexion réussie. */
async function recordSuccess(key) {
  await pool.query('DELETE FROM login_throttle WHERE throttle_key = :key', { key });
}

module.exports = { assertNotLocked, recordFailure, recordSuccess };
