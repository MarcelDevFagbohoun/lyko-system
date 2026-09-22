'use strict';

/**
 * Alerte de balance déséquilibrée (section 6) — filet de sécurité : chaque
 * écriture est déjà vérifiée équilibrée à l'insertion (`genererEcriture`,
 * livrable 5) et la clôture d'exercice revérifie l'exercice entier avant de
 * verrouiller (`cloturerExercice`). Ceci NE DEVRAIT JAMAIS se déclencher —
 * seul un accès direct à la base hors de l'application pourrait produire un
 * déséquilibre. Tourne uniquement pour les tenants ayant activé le module
 * (`isModuleActive`) : sans plan comptable, il n'y a rien à vérifier.
 */

const { pool } = require('../config/db');
const { isModuleActive } = require('../services/gl/glPostingService');
const { computeTrialBalanceTotals } = require('../services/gl/glClosingService');
const { notifyDg } = require('../services/gl/glNotificationService');
const logger = require('../utils/logger');

async function runBalanceAlertJob() {
  const [tenants] = await pool.query('SELECT id FROM tenants');

  for (const { id: tenantId } of tenants) {
    try {
      if (!(await isModuleActive(pool, tenantId))) continue;

      const [openYears] = await pool.query(
        "SELECT id, label FROM gl_fiscal_years WHERE tenant_id = :tenantId AND status = 'ouvert'",
        { tenantId },
      );
      for (const fy of openYears) {
        const { totalDebit, totalCredit } = await computeTrialBalanceTotals(pool, tenantId, fy.id);
        if (totalDebit === totalCredit) continue;

        await notifyDg(pool, {
          tenantId,
          type: 'balance_imbalance_alert',
          message: `ALERTE : l'exercice ${fy.label} est déséquilibré (débit ${totalDebit} ≠ crédit ${totalCredit}) — contactez le support technique`,
          entityTable: 'gl_fiscal_years',
          entityId: fy.id,
        });
        logger.error('Balance comptable déséquilibrée détectée', { tenantId, fiscalYearId: fy.id, totalDebit, totalCredit });
      }
    } catch (err) {
      logger.error('Échec vérification de balance', { tenantId, error: err.message });
    }
  }
}

module.exports = { runBalanceAlertJob };
