'use strict';

/**
 * Notifications push navigateur (Web Push API) — accessible à TOUS les rôles
 * connectés (dg, comptable, agent), contrairement à `/gl/notifications` qui
 * ne concerne que le DG : chacun gère l'abonnement de son propre appareil.
 */

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth } = require('../middleware/auth');
const { vapidConfigured } = require('../services/push/sendPush');

const router = Router();

// GET /api/push/vapid-public-key — clé PUBLIQUE nécessaire au navigateur pour
// s'abonner (PushManager.subscribe). Volontairement avant `requireAuth` : une
// clé publique n'expose rien, et ça simplifie l'appel côté frontend.
router.get('/vapid-public-key', (req, res) => {
  if (!vapidConfigured) return res.json({ configured: false, publicKey: null });
  res.json({ configured: true, publicKey: process.env.PLATFORM_VAPID_PUBLIC_KEY });
});

router.use(requireAuth);

// POST /api/push/subscribe — enregistre (ou met à jour) l'abonnement de CET
// appareil pour l'utilisateur connecté. `ON DUPLICATE KEY` sur `endpoint` :
// le même navigateur peut se réabonner (clés renouvelées) sans doublon.
router.post('/subscribe', async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      throw new ApiError(400, 'Abonnement push invalide (endpoint ou clés manquants).');
    }
    await pool.query(
      `INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth, user_agent)
       VALUES (:tenantId, :userId, :endpoint, :p256dh, :auth, :userAgent)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), tenant_id = VALUES(tenant_id), p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent)`,
      {
        tenantId: req.user.tenantId,
        userId: req.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 250),
      },
    );
    res.status(201).json({ subscribed: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/push/unsubscribe — retire l'abonnement de CET appareil.
router.post('/unsubscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) throw new ApiError(400, 'endpoint requis.');
    await pool.query('DELETE FROM push_subscriptions WHERE user_id = :userId AND endpoint = :endpoint', {
      userId: req.user.id,
      endpoint,
    });
    res.json({ subscribed: false });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
