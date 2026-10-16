'use strict';

/**
 * Rappel de fin d'exercice comptable (audit comptabilité avancée, point 9, 16/10/2026) — filet de
 * sécurité : si personne n'ouvre le prochain exercice à temps, TOUTE opération financière du cabinet
 * (loyer, dépense, versement, charge...) échoue dès le lendemain de la fin de l'exercice en cours
 * (`resolveOpenFiscalYear`, `glPostingService.js`, volontaire — voir son commentaire). Avant ce job,
 * rien n'avertissait le DG avant que ça ne bloque réellement une opération métier sans rapport avec la
 * comptabilité (ex. le formulaire de dépense) — ce job prévient PENDANT qu'il est encore temps d'agir,
 * sans attendre le premier blocage réel.
 *
 * Ne dépend que de `gl_module_enabled` (même garde que `balanceAlertJob`) : sans plan comptable actif,
 * il n'y a pas d'exercice à surveiller.
 */

const { pool } = require('../config/db');
const { isModuleActive } = require('../services/gl/glPostingService');
const { notifyDg } = require('../services/gl/glNotificationService');
const logger = require('../utils/logger');

// Marge avant la fin de l'exercice ouvert à partir de laquelle on avertit — assez tôt pour que le DG
// ait le temps d'ouvrir le suivant sans jamais se retrouver bloqué en pratique.
const WARNING_MARGIN_DAYS = 30;

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// `tenantIds` / `today` : uniquement pour les tests (cibler un cabinet jetable et fixer la date) — le
// planificateur l'appelle sans argument : tous les cabinets, aujourd'hui.
async function runFiscalYearExpiryJob({ tenantIds = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const tenants = tenantIds ? tenantIds.map((id) => ({ id })) : (await pool.query('SELECT id FROM tenants'))[0];

  for (const { id: tenantId } of tenants) {
    try {
      if (!(await isModuleActive(pool, tenantId))) continue;

      const [openYears] = await pool.query(
        "SELECT id, label, end_date FROM gl_fiscal_years WHERE tenant_id = :tenantId AND status = 'ouvert'",
        { tenantId },
      );
      for (const fy of openYears) {
        const endDate = fy.end_date.toISOString().slice(0, 10);
        const warnFrom = addDays(endDate, -WARNING_MARGIN_DAYS);
        if (today < warnFrom || today > endDate) continue; // trop tôt, ou déjà dépassé (verra l'échec réel)

        // Le prochain exercice a-t-il déjà été ouvert ? Si oui, rien à signaler — le DG a déjà anticipé.
        const [[nextDay]] = await pool.query(
          `SELECT id FROM gl_fiscal_years
           WHERE tenant_id = :tenantId AND start_date <= :dayAfter AND end_date >= :dayAfter LIMIT 1`,
          { tenantId, dayAfter: addDays(endDate, 1) },
        );
        if (nextDay) continue;

        // Une seule notification par exercice (jamais un rappel quotidien répété pendant toute la
        // marge de 30 jours) — même principe de dédoublonnage que `closingReminderJob`.
        const [existing] = await pool.query(
          "SELECT id FROM gl_notifications WHERE tenant_id = :tenantId AND type = 'fiscal_year_ending_soon' AND entity_id = :fyId LIMIT 1",
          { tenantId, fyId: fy.id },
        );
        if (existing[0]) continue;

        await notifyDg(pool, {
          tenantId,
          type: 'fiscal_year_ending_soon',
          message: `L'exercice comptable "${fy.label}" se termine le ${endDate} — pensez à ouvrir le suivant depuis Comptabilité avancée, sans quoi aucune opération financière ne pourra plus être enregistrée après cette date`,
          entityTable: 'gl_fiscal_years',
          entityId: fy.id,
        });
      }
    } catch (err) {
      logger.error("Échec rappel de fin d'exercice comptable", { tenantId, error: err.message });
    }
  }
}

module.exports = { runFiscalYearExpiryJob };
