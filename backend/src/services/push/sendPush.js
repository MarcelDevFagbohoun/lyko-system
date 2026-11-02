'use strict';

const webpush = require('web-push');
const { pool } = require('../../config/db');
const logger = require('../../utils/logger');

const PUBLIC_KEY = process.env.PLATFORM_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.PLATFORM_VAPID_PRIVATE_KEY;
const SUBJECT = process.env.PLATFORM_VAPID_SUBJECT || 'mailto:contact@africaimmomanagement.com';

const configured = Boolean(PUBLIC_KEY && PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
} else {
  logger.warn('Web Push non configuré (PLATFORM_VAPID_PUBLIC_KEY / PLATFORM_VAPID_PRIVATE_KEY manquants) : notifications push désactivées.');
}

/**
 * Envoie une notification push à TOUS les appareils abonnés d'un utilisateur
 * (un même compte peut être ouvert sur plusieurs navigateurs/téléphones).
 *
 * Ne lève JAMAIS d'exception pour l'appelant : une notification ratée (réseau,
 * abonnement expiré, clé mal formée...) ne doit jamais faire échouer l'action
 * métier qui la déclenche — même principe défensif que `services/payments/notify.js`.
 * Un abonnement expiré/révoqué (404/410 renvoyé par le service de push du
 * navigateur) est supprimé au passage : il ne sera plus retenté inutilement.
 */
async function sendPushToUser(userId, { title, body, url = '/espace', tag } = {}) {
  if (!configured || !userId) return;
  try {
    const [subs] = await pool.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = :userId',
      { userId },
    );
    if (!subs.length) return;

    const payload = JSON.stringify({ title, body, url, tag });

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await pool.query('DELETE FROM push_subscriptions WHERE id = :id', { id: sub.id }).catch(() => {});
          } else {
            logger.warn("Échec d'envoi d'une notification push", { userId, subscriptionId: sub.id, error: err.message });
          }
        }
      }),
    );
  } catch (err) {
    logger.warn('Échec du service de notifications push (ignoré, sans impact sur l\'opération en cours)', { userId, error: err.message });
  }
}

/** Envoie à tous les utilisateurs actifs d'un rôle donné, pour une entreprise. */
async function sendPushToRole(tenantId, role, payload) {
  if (!configured) return;
  try {
    const [users] = await pool.query(
      "SELECT id FROM users WHERE tenant_id = :tenantId AND role = :role AND status = 'active'",
      { tenantId, role },
    );
    await Promise.all(users.map((u) => sendPushToUser(u.id, payload)));
  } catch (err) {
    logger.warn('Échec du service de notifications push (rôle)', { tenantId, role, error: err.message });
  }
}

module.exports = { sendPushToUser, sendPushToRole, vapidConfigured: configured };
