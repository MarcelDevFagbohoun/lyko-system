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
const { getPeriodClosability } = require('../services/accountingPeriods');
const { getNextMonthToClose } = require('../services/closingOverview');
const { notifyDg } = require('../services/gl/glNotificationService');
const logger = require('../utils/logger');

async function runClosingReminderJob() {
  const [tenants] = await pool.query('SELECT id FROM tenants');
  const currentMonth = new Date().toISOString().slice(0, 7);

  for (const { id: tenantId } of tenants) {
    // Étape 54 : seul le PROCHAIN mois à clôturer compte (les mois se clôturent dans l'ordre) — avant,
    // le mois en cours et le précédent étaient vérifiés, ce qui pouvait signaler un mois que la
    // clôture aurait refusé faute d'avoir clôturé le précédent.
    for (const period of [await getNextMonthToClose(tenantId)].filter((p) => p && p <= currentMonth)) {
      try {
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
          message: `Le mois ${period} est clôturable — pensez à le clôturer depuis la page Clôture`,
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
