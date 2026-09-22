'use strict';

/**
 * Rappel de clôture mensuelle (section 6) — réutilise TEL QUEL le calcul de
 * clôturabilité déjà existant (`getPeriodClosability`, `routes/accounting.js
 * POST /periods`) : zéro nouvelle règle métier. Ne dépend pas du module
 * SYSCOHADA (`accounting_periods` existe indépendamment, étape 8/15).
 *
 * Notifie le DG UNE SEULE FOIS par mois devenu clôturable (pas un rappel
 * quotidien répété tant qu'il n'a pas clôturé) : dédoublonnage explicite sur
 * (tenant, type, période) avant d'écrire une nouvelle notification.
 */

const { pool } = require('../config/db');
const { isPeriodClosed, getPeriodClosability } = require('../services/accountingPeriods');
const { notifyDg } = require('../services/gl/glNotificationService');
const logger = require('../utils/logger');

// On ne vérifie que le mois EN COURS et le précédent : un mois plus ancien
// encore ouvert a déjà été signalé (ou volontairement laissé ouvert par le
// DG) — pas besoin de remonter indéfiniment dans le temps chaque jour.
function candidatePeriods() {
  const now = new Date();
  const current = now.toISOString().slice(0, 7);
  const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previous = prevDate.toISOString().slice(0, 7);
  return [previous, current];
}

async function runClosingReminderJob() {
  const [tenants] = await pool.query('SELECT id FROM tenants');
  const periods = candidatePeriods();

  for (const { id: tenantId } of tenants) {
    for (const period of periods) {
      try {
        if (await isPeriodClosed(tenantId, `${period}-01`)) continue;

        const closability = await getPeriodClosability(tenantId, period);
        if (!closability.isClosable) continue;

        const [existing] = await pool.query(
          `SELECT id FROM gl_notifications
           WHERE tenant_id = :tenantId AND type = 'closing_reminder' AND message LIKE :periodLike LIMIT 1`,
          { tenantId, periodLike: `%${period}%` },
        );
        if (existing[0]) continue;

        await notifyDg(pool, {
          tenantId,
          type: 'closing_reminder',
          message: `Le mois ${period} est clôturable — pensez à clôturer la période depuis Comptabilité`,
          entityTable: 'tenants',
          entityId: tenantId,
        });
      } catch (err) {
        logger.error('Échec rappel de clôture mensuelle', { tenantId, period, error: err.message });
      }
    }
  }
}

module.exports = { runClosingReminderJob };
