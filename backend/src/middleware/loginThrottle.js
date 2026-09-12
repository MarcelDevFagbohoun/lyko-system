'use strict';

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
 *  - État en mémoire du process : remis à zéro au redéploiement, non partagé
 *    entre instances. Suffisant pour le déploiement mono-instance (Docker
 *    Compose, étape 12b). Version persistante (colonnes `failed_attempts` /
 *    `locked_until` sur `users`) = évolution notée, non requise ici.
 */

const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

/** @type {Map<string, { failures: number[], lockedUntil: number }>} */
const attempts = new Map();

/** Purge périodique : évite que la Map grossisse indéfiniment. */
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    const recent = entry.failures.filter((t) => now - t < WINDOW_MS);
    if (recent.length === 0 && entry.lockedUntil < now) {
      attempts.delete(key);
    } else {
      entry.failures = recent;
    }
  }
}, 10 * 60 * 1000);
sweep.unref();

/** Lève une 429 si l'identifiant est actuellement bloqué. À appeler avant de vérifier le mot de passe. */
function assertNotLocked(key) {
  const entry = attempts.get(key);
  if (entry && entry.lockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    throw new ApiError(429, `Trop de tentatives sur ce compte. Réessayez dans ${minutes} min.`);
  }
}

/** Enregistre un échec d'authentification pour cet identifiant ; arme le blocage au seuil atteint. */
function recordFailure(key) {
  const now = Date.now();
  const entry = attempts.get(key) || { failures: [], lockedUntil: 0 };
  entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS);
  entry.failures.push(now);
  if (entry.failures.length >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCK_MS;
    entry.failures = [];
  }
  attempts.set(key, entry);
}

/** Réinitialise le compteur après une connexion réussie. */
function recordSuccess(key) {
  attempts.delete(key);
}

module.exports = { assertNotLocked, recordFailure, recordSuccess };
