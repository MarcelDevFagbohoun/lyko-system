'use strict';

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config/env');
const { verifyAccessToken } = require('../utils/jwt');

/**
 * Regroupe les protections transversales appliquées à toutes les routes.
 * Durci à l'étape 12 (audit sécurité) : HSTS explicite (2 ans + preload),
 * CSP « API JSON » verrouillée, limiteur global.
 */

const corsMiddleware = cors({
  origin(origin, callback) {
    // Autorise les outils sans en-tête Origin (curl, health-checks) et les origines whitelistées.
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origine non autorisée par CORS : ${origin}`));
  },
  credentials: true,
});

// Limiteur global : garde-fou contre le brute-force / scraping.
// Utilisateur connecté => compté PAR ENTREPRISE (plafond large : plusieurs employés derrière une même connexion
// internet ne se bloquent pas entre eux) ; visiteur anonyme => compté par adresse IP (plafond serré).
function authedTenant(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    return verifyAccessToken(token).tenantId || null;
  } catch (_e) {
    return null;
  }
}
const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  keyGenerator: (req) => {
    const t = authedTenant(req);
    return t ? `tenant:${t}` : `ip:${req.ip}`;
  },
  max: (req) => (authedTenant(req) ? (config.isProd ? 3000 : 10000) : config.isProd ? 300 : 1000),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});

const helmetMiddleware = helmet({
  // L'API sert du JSON : CSP stricte par défaut, pas de ressources cross-origin.
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
    },
  },
  // HSTS : forcer HTTPS pendant 2 ans, sous-domaines inclus, éligible à la
  // liste de préchargement des navigateurs. N'a d'effet qu'une fois servi en
  // HTTPS (reverse-proxy TLS de l'étape 12b) — inoffensif en HTTP local.
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
});

module.exports = { corsMiddleware, globalRateLimiter, helmetMiddleware };
