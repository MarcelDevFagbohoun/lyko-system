'use strict';

const { pool } = require('../config/db');
const { ApiError } = require('./error');
const { hashToken } = require('../utils/tokens');

/**
 * Authentification du portail locataire : le token du lien (jamais un mot
 * de passe) identifie directement un locataire, tous tenants confondus tant
 * que le token n'est pas connu — on ne fait confiance qu'à son empreinte
 * SHA-256, comparée à `renters.portal_token_hash` (jamais le token en clair
 * stocké, même principe que les refresh tokens).
 *
 * 404 générique si le token est invalide/révoqué : jamais de distinction
 * entre « token inconnu » et « locataire supprimé » (pas d'énumération).
 * Attache `req.portalRenter = { id, tenantId, firstName, lastName }`.
 */
async function requirePortalToken(req, res, next) {
  const token = req.params.token;
  if (!token || token.length < 20) {
    return next(new ApiError(404, 'Lien invalide ou expiré'));
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, tenant_id, first_name, last_name FROM renters WHERE portal_token_hash = :hash LIMIT 1',
      { hash: hashToken(token) },
    );
    if (!rows[0]) {
      return next(new ApiError(404, 'Lien invalide ou expiré'));
    }
    req.portalRenter = {
      id: rows[0].id,
      tenantId: rows[0].tenant_id,
      firstName: rows[0].first_name,
      lastName: rows[0].last_name,
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requirePortalToken };
