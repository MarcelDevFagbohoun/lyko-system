'use strict';

// Abonnement partenaire : offert par la plateforme pour un nombre de mois, avec les fonctions cochées une à une.
// Aucun paiement : tout vit dans la ligne tenant_subscriptions (plan_key = 'partenaire'). Le service possède le SQL
// et la transaction ; la route garde la validation du formulaire et le journal d'audit de l'administrateur.

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { PARTNER_SELECTABLE_FEATURES } = require('../constants/plans');

const MAX_MONTHS = 60;
const PAID_PLANS = ['demarrage', 'pro', 'entreprise'];
const OPEN_REFUND_STATUSES = ['requested', 'approved', 'details_received', 'processing', 'failed'];

async function logEvent(conn, tenantId, type, adminId, details) {
  await conn.query(
    'INSERT INTO subscription_events (tenant_id, event_type, actor, details) VALUES (:tenantId, :type, :actor, :details)',
    { tenantId, type, actor: `admin:${adminId}`, details: JSON.stringify(details) },
  );
}

/**
 * Attribue (ou prolonge) l'abonnement partenaire. Déjà partenaire et en cours : les mois s'ajoutent à l'échéance et les
 * fonctions/limites sont remplacées par celles envoyées. Une offre payante en cours n'est remplacée que si
 * `replacePaid` est vrai (les mois déjà payés sont alors perdus pour le client : l'administrateur doit le confirmer).
 */
async function grantPartner({ tenantId, adminId, months, features, limits, note, replacePaid = false }) {
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) throw new ApiError(400, `Durée invalide : de 1 à ${MAX_MONTHS} mois.`);
  const unknown = features.filter((f) => !PARTNER_SELECTABLE_FEATURES.includes(f));
  if (unknown.length) throw new ApiError(400, `Fonction inconnue : ${unknown.join(', ')}`);
  const chosen = [...new Set(features)];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[tenant]] = await conn.query('SELECT id FROM tenants WHERE id = :id FOR UPDATE', { id: tenantId });
    if (!tenant) throw new ApiError(404, 'Entreprise introuvable');
    await conn.query("INSERT IGNORE INTO tenant_subscriptions (tenant_id, plan_key, status) VALUES (:t, NULL, 'pending_payment')", { t: tenantId });
    const [[cur]] = await conn.query(
      'SELECT plan_key, status, (current_period_end IS NOT NULL AND current_period_end > NOW()) AS running FROM tenant_subscriptions WHERE tenant_id = :t FOR UPDATE',
      { t: tenantId },
    );
    const live = cur.status === 'active' && Number(cur.running) === 1;
    const extend = live && cur.plan_key === 'partenaire';
    const replacing = live && PAID_PLANS.includes(cur.plan_key);
    if (replacing) {
      if (!replacePaid) {
        throw new ApiError(409, "Cette entreprise a un abonnement payant en cours : l'attribuer maintenant remplace les mois déjà payés. Confirmez pour continuer.", { code: 'PAID_SUBSCRIPTION_RUNNING' });
      }
      const [[open]] = await conn.query(
        `SELECT id FROM subscription_refunds WHERE tenant_id = :t AND status IN (${OPEN_REFUND_STATUSES.map((s) => `'${s}'`).join(',')}) LIMIT 1`,
        { t: tenantId },
      );
      if (open) throw new ApiError(409, "Une demande d'annulation de cette entreprise est en cours d'examen : traitez-la d'abord.");
      // Les périodes payées sont remplacées : elles ne peuvent plus servir de crédit ni de remboursement.
      await conn.query("UPDATE subscription_payments SET consumed_at = NOW() WHERE tenant_id = :t AND status = 'paid' AND consumed_at IS NULL AND period_end IS NOT NULL AND period_end > NOW()", { t: tenantId });
    }
    await conn.query(
      `UPDATE tenant_subscriptions SET plan_key = 'partenaire', status = 'active', period_months = :months,
         started_at = IF(:extend = 1, started_at, NOW()),
         current_period_end = DATE_ADD(IF(:extend = 1, current_period_end, NOW()), INTERVAL :months MONTH),
         partner_features = :features, partner_limits = :limits, partner_note = :note,
         partner_since = IF(:extend = 1, COALESCE(partner_since, NOW()), NOW()),
         refund_eligible_until = NULL, reminder_sent_for = NULL, reminder_days = NULL
       WHERE tenant_id = :t`,
      { months, extend: extend ? 1 : 0, features: JSON.stringify(chosen), limits: JSON.stringify(limits), note, t: tenantId },
    );
    const [[after]] = await conn.query('SELECT current_period_end FROM tenant_subscriptions WHERE tenant_id = :t', { t: tenantId });
    await logEvent(conn, tenantId, extend ? 'partner_extended' : 'partner_granted', adminId, {
      months, features: chosen, limits, note, replacedPlan: replacing ? cur.plan_key : undefined,
    });
    await conn.commit();
    return { extended: extend, replacedPlan: replacing ? cur.plan_key : null, currentPeriodEnd: after.current_period_end, features: chosen, limits };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Met fin au partenariat tout de suite : l'entreprise devra souscrire une offre pour continuer. */
async function revokePartner({ tenantId, adminId, note }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[cur]] = await conn.query('SELECT plan_key, status FROM tenant_subscriptions WHERE tenant_id = :t FOR UPDATE', { t: tenantId });
    if (!cur || cur.plan_key !== 'partenaire' || cur.status !== 'active') throw new ApiError(400, "Cette entreprise n'a pas d'abonnement partenaire en cours.");
    await conn.query("UPDATE tenant_subscriptions SET status = 'cancelled', current_period_end = NOW() WHERE tenant_id = :t", { t: tenantId });
    await logEvent(conn, tenantId, 'partner_revoked', adminId, { note });
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { grantPartner, revokePartner, MAX_MONTHS };
