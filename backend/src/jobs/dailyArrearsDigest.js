'use strict';

/**
 * Liste quotidienne des relances (section 6, "clients à relancer avant le 5
 * du mois") — résumé quotidien envoyé au DG, réutilise TEL QUEL le calcul
 * déjà existant (`listPortfolioArrears`, étape 10 / centre de relance) : zéro
 * nouvelle règle métier. Ne dépend pas du module SYSCOHADA (les impayés
 * existent indépendamment de la comptabilité en partie double).
 *
 * "Avant le 5 du mois" ne restreint pas QUAND ce job tourne (il tourne tous
 * les jours, un retard reste un retard) — seulement calqué sur le rappel
 * initial du cahier des charges ; le comptable/DG voit toujours l'état réel,
 * pas une fenêtre artificielle.
 */

const { pool } = require('../config/db');
const { listPortfolioArrears } = require('../services/rentTracking');
const { notifyDg } = require('../services/gl/glNotificationService');
const logger = require('../utils/logger');

async function runDailyArrearsDigest() {
  const [tenants] = await pool.query('SELECT id FROM tenants');
  const today = new Date().toISOString().slice(0, 10);

  for (const { id: tenantId } of tenants) {
    try {
      const arrears = await listPortfolioArrears(tenantId, null);
      if (arrears.length === 0) continue;

      const [existing] = await pool.query(
        `SELECT id FROM gl_notifications
         WHERE tenant_id = :tenantId AND type = 'daily_arrears_digest' AND DATE(created_at) = :today LIMIT 1`,
        { tenantId, today },
      );
      if (existing[0]) continue;

      const total = arrears.reduce((s, a) => s + a.amountOwed, 0);
      await notifyDg(pool, {
        tenantId,
        type: 'daily_arrears_digest',
        message: `${arrears.length} locataire(s) en retard de loyer, ${total} FCFA à relancer`,
        entityTable: 'tenants',
        entityId: tenantId,
      });
    } catch (err) {
      logger.error('Échec génération de la liste quotidienne des relances', { tenantId, error: err.message });
    }
  }
}

module.exports = { runDailyArrearsDigest };
