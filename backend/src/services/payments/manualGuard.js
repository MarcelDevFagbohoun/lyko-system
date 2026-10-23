'use strict';

const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');

/**
 * Quand l'entreprise a activé FedaPay, tout décaissement de salaire ou de reversement propriétaire DOIT passer
 * par FedaPay : la saisie manuelle est refusée (sinon on pourrait déclarer « payé » sans que l'argent soit parti).
 */
async function assertManualPaymentAllowed(tenantId, what) {
  const [[t]] = await pool.query('SELECT fedapay_enabled FROM tenants WHERE id = :tenantId LIMIT 1', { tenantId });
  if (t?.fedapay_enabled) {
    const err = new ApiError(409, `Le paiement par FedaPay est activé : ${what} doit être effectué depuis le menu Paiements (envoi Mobile Money).`);
    err.code = 'FEDAPAY_REQUIRED';
    throw err;
  }
}

module.exports = { assertManualPaymentAllowed };
