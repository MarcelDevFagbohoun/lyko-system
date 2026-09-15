'use strict';

const { verifyMarketplaceToken } = require('../utils/jwt');
const { ApiError } = require('./error');

/**
 * Comptes du grand public sur Quick Immo (site externe séparé, relié à
 * cette plateforme) — chercheurs de logement et propriétaires qui
 * s'inscrivent eux-mêmes. Un realm de jeton totalement distinct des
 * employés (`requireAuth`) : `req.account` plutôt que `req.user`, jamais
 * les deux en même temps sur une route.
 */
function requireMarketplaceAccount(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Authentification requise'));
  }
  try {
    const payload = verifyMarketplaceToken(token);
    req.account = { id: payload.sub, tenantId: payload.tenantId, role: payload.role };
    next();
  } catch (_err) {
    next(new ApiError(401, 'Session invalide ou expirée'));
  }
}

/** Restreint une route à un rôle de compte (ex. requireAccountRole('proprietaire')). */
function requireAccountRole(...roles) {
  return (req, res, next) => {
    if (!req.account) return next(new ApiError(401, 'Authentification requise'));
    if (!roles.includes(req.account.role)) {
      return next(new ApiError(403, 'Accès refusé pour ce type de compte'));
    }
    next();
  };
}

module.exports = { requireMarketplaceAccount, requireAccountRole };
