'use strict';

const { pool } = require('../config/db');
const { ApiError } = require('./error');

/**
 * Le module Charges (SONEB/SBEE) est optionnel : certaines entreprises ne l'utilisent pas.
 * Désactivé dans Paramètres, ses routes répondent 403 (le DG peut le réactiver à tout moment ;
 * rien n'est supprimé).
 */
async function isChargesEnabled(tenantId) {
  const [[t]] = await pool.query('SELECT charges_enabled FROM tenants WHERE id = :tenantId', { tenantId });
  return !t || Number(t.charges_enabled) === 1;
}

async function requireChargesEnabled(req, _res, next) {
  try {
    if (!(await isChargesEnabled(req.user.tenantId))) {
      return next(new ApiError(403, "Le module Charges n'est pas activé pour votre entreprise (Paramètres).", { code: 'CHARGES_DISABLED' }));
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireChargesEnabled, isChargesEnabled };
