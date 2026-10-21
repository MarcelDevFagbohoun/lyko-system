'use strict';

/**
 * Abonnements : (1) marque « expired » les abonnements dont l'échéance est passée (le blocage lui-même ne dépend pas de
 * ce job : `getEntitlements` compare l'échéance à NOW() en direct) ; (2) envoie les rappels J-7, J-1 et « terminé ».
 * Un rappel par seuil et par échéance (`reminder_sent_for` + `reminder_days`) : relancer le job n'écrit jamais deux fois.
 */
const { pool } = require('../config/db');
const config = require('../config/env');
const logger = require('../utils/logger');
const { sendSubscriptionReminderEmail } = require('../services/email/sendEmail');
const { getPlanAsync } = require('../services/planCatalog');

async function runSubscriptionJob() {
  await pool.query("UPDATE tenant_subscriptions SET status = 'expired' WHERE status = 'active' AND plan_key <> 'interne' AND current_period_end <= NOW()");
  await pool.query(
    `INSERT INTO subscription_events (tenant_id, event_type, actor, details)
     SELECT s.tenant_id, 'expired', 'job', NULL FROM tenant_subscriptions s
     WHERE s.status = 'expired' AND NOT EXISTS (
       SELECT 1 FROM subscription_events e WHERE e.tenant_id = s.tenant_id AND e.event_type = 'expired' AND e.created_at >= s.current_period_end)`,
  );
  const [rows] = await pool.query(
    `SELECT s.tenant_id, s.plan_key, s.current_period_end, s.reminder_sent_for, s.reminder_days,
            DATEDIFF(s.current_period_end, NOW()) AS days_left, (s.current_period_end <= NOW()) AS is_over,
            t.company_name, u.first_name, u.email
     FROM tenant_subscriptions s
     JOIN tenants t ON t.id = s.tenant_id
     JOIN users u ON u.tenant_id = s.tenant_id AND u.role = 'dg' AND u.email IS NOT NULL
     WHERE s.plan_key IS NOT NULL AND s.plan_key <> 'interne' AND s.status IN ('active','expired')
       AND s.current_period_end > DATE_SUB(NOW(), INTERVAL 3 DAY) AND s.current_period_end <= DATE_ADD(NOW(), INTERVAL 8 DAY)
     GROUP BY s.tenant_id`,
  );
  for (const r of rows) {
    const threshold = Number(r.is_over) === 1 ? 0 : Number(r.days_left) <= 1 ? 1 : Number(r.days_left) <= 7 ? 7 : null;
    if (threshold === null) continue;
    const same = r.reminder_sent_for && new Date(r.reminder_sent_for).getTime() === new Date(r.current_period_end).getTime();
    if (same && r.reminder_days !== null && r.reminder_days <= threshold) continue;
    try {
      await sendSubscriptionReminderEmail({
        to: r.email, dgName: r.first_name, companyName: r.company_name, planLabel: (await getPlanAsync(r.plan_key)).label,
        daysLeft: threshold, renewUrl: `${config.frontendUrl}/abonnement`,
      });
      await pool.query('UPDATE tenant_subscriptions SET reminder_sent_for = current_period_end, reminder_days = :d WHERE tenant_id = :t', { d: threshold, t: r.tenant_id });
    } catch (err) {
      logger.warn('Rappel d’abonnement non envoyé', { tenantId: r.tenant_id, message: err.message });
    }
  }
}

module.exports = { runSubscriptionJob };
