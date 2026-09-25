'use strict';

/**
 * Alertes quotidiennes du suivi des charges SONEB/SBEE (étape 31) — réutilise
 * TEL QUEL le calcul des alertes (`listUtilityAlerts`) : zéro nouvelle règle
 * métier. Ne dépend pas du module SYSCOHADA.
 *
 * Notifie le DG au plus UNE FOIS par jour (jour de la base, comme `created_at`) et seulement s'il y a au moins une
 * alerte (dédoublonnage explicite sur (tenant, type, jour), comme la liste
 * quotidienne des relances) ; le détail complet reste consultable à tout
 * moment sur « Le point des charges ».
 */

const { pool } = require('../config/db');
const { listUtilityAlerts } = require('../services/utilityAlerts');
const { notifyDg } = require('../services/gl/glNotificationService');
const logger = require('../utils/logger');

const TYPE_LABELS = {
  releve_manquant: (n) => `${n} relevé${n > 1 ? 's' : ''} manquant${n > 1 ? 's' : ''}`,
  releve_a_valider: (n) => `${n} relevé${n > 1 ? 's' : ''} à valider`,
  facture_mere_non_declaree: (n) => `${n} facture${n > 1 ? 's' : ''} mère${n > 1 ? 's' : ''} non déclarée${n > 1 ? 's' : ''} payée${n > 1 ? 's' : ''}`,
  ecart_eleve: (n) => `${n} écart${n > 1 ? 's' : ''} anormal${n > 1 ? 'ux' : ''}`,
  charges_a_reverser: (n) => `${n} propriétaire${n > 1 ? 's' : ''} à qui reverser des charges`,
};

function buildDigestMessage(alerts) {
  const counts = new Map();
  for (const a of alerts) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  const parts = [...counts.entries()].map(([type, n]) => (TYPE_LABELS[type] ? TYPE_LABELS[type](n) : `${n} ${type}`));
  return `Charges SONEB/SBEE : ${parts.join(', ')} — voir « Le point des charges »`;
}

// `tenantIds` / `today` : uniquement pour les tests (cibler un cabinet jetable et
// fixer la date) — le planificateur l'appelle sans argument : tous les cabinets, aujourd'hui.
async function runUtilityAlertsJob({ tenantIds = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const tenants = tenantIds ? tenantIds.map((id) => ({ id })) : (await pool.query('SELECT id FROM tenants'))[0];

  for (const { id: tenantId } of tenants) {
    try {
      const alerts = await listUtilityAlerts(tenantId, { today });
      if (alerts.length === 0) continue;

      const [existing] = await pool.query(
        `SELECT id FROM gl_notifications
         WHERE tenant_id = :tenantId AND type = 'utility_alerts_digest' AND DATE(created_at) = CURDATE() LIMIT 1`,
        { tenantId },
      );
      if (existing[0]) continue;

      await notifyDg(pool, {
        tenantId,
        type: 'utility_alerts_digest',
        message: buildDigestMessage(alerts),
        entityTable: 'tenants',
        entityId: tenantId,
      });
    } catch (err) {
      logger.error('Échec des alertes quotidiennes du suivi des charges', { tenantId, error: err.message });
    }
  }
}

module.exports = { runUtilityAlertsJob, buildDigestMessage };
