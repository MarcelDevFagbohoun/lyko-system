'use strict';

/**
 * Suivi des paiements sortants : FedaPay ne documente pas de webhook pour les envois, le serveur relit donc
 * lui-même le statut des ordres `processing` (jamais de statut fourni par un tiers). Chaque ordre n'est relu
 * qu'à partir de 30 s après sa création, et abandonné (laissé `processing`, visible dans l'interface) après 7 jours.
 */

const { pool } = require('../config/db');
const { refreshOrder } = require('../services/payments/orders');
const logger = require('../utils/logger');

async function runPaymentStatusJob({ tenantIds = null } = {}) {
  const params = {};
  let where = "status = 'processing' AND fedapay_payout_id IS NOT NULL AND created_at < (NOW() - INTERVAL 30 SECOND) AND created_at > (NOW() - INTERVAL 7 DAY)";
  if (tenantIds) {
    where += ' AND tenant_id IN (:tenantIds)';
    params.tenantIds = tenantIds;
  }
  const [rows] = await pool.query(`SELECT id, tenant_id FROM payment_orders WHERE ${where} ORDER BY id ASC LIMIT 100`, params);
  let advanced = 0;
  for (const row of rows) {
    try {
      const after = await refreshOrder(row.tenant_id, row.id);
      if (after.status !== 'processing') advanced += 1;
    } catch (err) {
      logger.error('Suivi du paiement sortant en erreur', { orderId: row.id, message: err.message });
    }
  }
  return { checked: rows.length, advanced };
}

module.exports = { runPaymentStatusJob };
