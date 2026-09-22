'use strict';

/**
 * Génération des loyers attendus chaque mois (section 6 du cahier des
 * charges, "Automatisations") — INFORMATIF uniquement : un résumé envoyé au
 * DG (nombre de baux actifs + total des loyers mensuels attendus), jamais une
 * écriture comptable. La comptabilisation d'une créance de loyer avant
 * encaissement (comptabilité d'engagement) est un choix de jugement comptable
 * qui n'a pas été validé — voir la liste d'hypothèses livrée séparément ;
 * aucune règle n'a été inventée ici. Le moteur (`genererEcriture`) ne
 * comptabilise le loyer qu'à l'encaissement réel (`loyer_encaisse`), comme
 * avant. Ne dépend PAS du module SYSCOHADA (fonctionne pour tout tenant,
 * comme `leases` lui-même).
 */

const { pool } = require('../config/db');
const { notifyDg } = require('../services/gl/glNotificationService');
const logger = require('../utils/logger');

async function runMonthlyRentDigest() {
  const [tenants] = await pool.query('SELECT id FROM tenants');
  const period = new Date().toISOString().slice(0, 7);

  for (const { id: tenantId } of tenants) {
    try {
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS n, COALESCE(SUM(monthly_rent), 0) AS total
         FROM leases WHERE tenant_id = :tenantId AND status = 'active'`,
        { tenantId },
      );
      if (Number(row.n) === 0) continue;

      // Dédoublonnage : un seul résumé par mois par tenant, même si le
      // serveur redémarre plusieurs fois le jour prévu.
      const [existing] = await pool.query(
        `SELECT id FROM gl_notifications
         WHERE tenant_id = :tenantId AND type = 'monthly_rent_digest' AND created_at >= :monthStart LIMIT 1`,
        { tenantId, monthStart: `${period}-01` },
      );
      if (existing[0]) continue;

      await notifyDg(pool, {
        tenantId,
        type: 'monthly_rent_digest',
        message: `Loyers attendus pour ${period} : ${row.n} bail(s) actif(s), ${Number(row.total)} FCFA au total`,
        // Résumé agrégé, pas un bail précis — `entityTable` pointe sur le
        // tenant lui-même plutôt que sur une ligne de `leases` en particulier.
        entityTable: 'tenants',
        entityId: tenantId,
      });
    } catch (err) {
      logger.error('Échec génération du résumé mensuel des loyers attendus', { tenantId, error: err.message });
    }
  }
}

module.exports = { runMonthlyRentDigest };
