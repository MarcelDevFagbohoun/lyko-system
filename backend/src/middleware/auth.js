'use strict';

const { verifyAccessToken } = require('../utils/jwt');
const { ApiError } = require('./error');
const { pool } = require('../config/db');

/** Exige un access token JWT valide dans l'en-tête Authorization: Bearer ... */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Authentification requise'));
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      mustChangePassword: !!payload.mustChangePassword,
    };
    next();
  } catch (_err) {
    next(new ApiError(401, 'Session invalide ou expirée'));
  }
}

/** Restreint une route à un ou plusieurs rôles (ex. requireRole('dg')). */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentification requise'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Accès refusé pour ce rôle'));
    }
    next();
  };
}

/**
 * Restreint une route à un module de permission (ex. requirePermission('locataires')).
 * Le DG passe toujours (accès total par rôle). À consommer par les routeurs
 * métier à partir de l'étape 4 — aucune route ne l'utilise encore à l'étape 3.
 */
function requirePermission(key) {
  return async (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentification requise'));
    if (req.user.role === 'dg') return next();
    try {
      const [rows] = await pool.query(
        'SELECT 1 FROM user_permissions WHERE user_id = :userId AND permission_key = :key LIMIT 1',
        { userId: req.user.id, key },
      );
      if (rows.length === 0) {
        return next(new ApiError(403, "Vous n'avez pas accès à ce module"));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Restreint une route à AU MOINS UN des modules de permission listés
 * (ex. requireAnyPermission('locataires', 'comptabilite') pour les paiements,
 * accessibles à l'agent comme au comptable — section 5 du cahier des charges).
 * Le DG passe toujours.
 */
function requireAnyPermission(...keys) {
  return async (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentification requise'));
    if (req.user.role === 'dg') return next();
    try {
      const placeholders = keys.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT 1 FROM user_permissions WHERE user_id = ? AND permission_key IN (${placeholders}) LIMIT 1`,
        [req.user.id, ...keys],
      );
      if (rows.length === 0) {
        return next(new ApiError(403, "Vous n'avez pas accès à ce module"));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireAuth, requireRole, requirePermission, requireAnyPermission };
