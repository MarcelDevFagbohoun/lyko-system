'use strict';

// Webhook KKiaPay — défense en profondeur : capte les paiements confirmés
// alors que le client n'est jamais revenu vers `.../payments/verify` (onglet
// fermé, coupure réseau juste après le paiement). PAS le mécanisme principal
// de confirmation (le callback client + `verify()` serveur suffisent déjà à
// enregistrer un paiement) — ce webhook rejoue exactement le même
// `verifyAndRecordKkiapay`, qui est idempotent.
//
// Un seul webhook Lyko reçoit les événements de TOUTES les entreprises : la
// référence interne posée dans `partnerId` à l'ouverture du widget (voir
// `frontend/lib/kkiapay.ts`) permet de résoudre l'entreprise concernée AVANT
// de pouvoir même vérifier la signature (il faut ses clés déchiffrées pour
// ça). Format : `t<tenantId>:rent:<leaseId>` / `t<tenantId>:charge:<chargeId>`
// / `t<tenantId>:link:<token>`.
//
// Forme exacte du payload à confirmer lors du premier test en sandbox réel
// (non testable sans compte KKiaPay actif) — plusieurs noms de champs
// plausibles sont tentés ci-dessous pour rester robuste au format observé.

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { hashToken } = require('../utils/tokens');
const kkiapay = require('../services/kkiapay');
const { verifyAndRecordKkiapay } = require('../services/paymentVerification');
const logger = require('../utils/logger');

const router = Router();

// Défense en profondeur, même principe que les autres routes publiques de
// l'application (portail, vérification, paiement) : le filtrage réel vient
// de la vérification d'origine (secret KKiaPay) et de la revérification
// serveur de chaque transaction, mais un quota dédié évite qu'un tiers
// inonde cet endpoint de requêtes forgées (chacune coûte au moins une
// requête base de données avant d'être rejetée).
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes.' },
});
router.use(webhookLimiter);

// `typeof === 'string'` sur chaque champ : le corps d'un webhook est une
// entrée externe non fiable avant toute vérification — un objet/tableau
// injecté à la place d'une chaîne ne doit jamais se propager plus loin
// (jusqu'à l'appel à l'API KKiaPay ou à une requête base de données).
function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0 && v.length <= 128) return v.trim();
  }
  return null;
}

function extractTransactionId(body) {
  return firstString(body?.transactionId, body?.transaction_id, body?.id);
}

function extractReference(body) {
  return firstString(body?.partnerId, body?.partner_id, body?.data, body?.reference);
}

async function resolveTarget(reference) {
  const match = /^t(\d+):(rent|charge|link):(.+)$/.exec(String(reference || ''));
  if (!match) return null;
  const tenantId = Number(match[1]);
  const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });
  const tenant = tenantRows[0];
  if (!tenant) return null;

  if (match[2] === 'rent') return { tenant, kind: 'rent', leaseId: Number(match[3]) };
  if (match[2] === 'charge') return { tenant, kind: 'charge', chargeId: Number(match[3]) };

  // kind === 'link' : le jeton du lien de paiement porte lui-même le type/id réel.
  const [linkRows] = await pool.query('SELECT * FROM payment_links WHERE token_hash = :hash LIMIT 1', {
    hash: hashToken(match[3]),
  });
  const link = linkRows[0];
  if (!link) return null;
  return {
    tenant,
    kind: link.kind === 'loyer' ? 'rent' : 'charge',
    leaseId: link.lease_id,
    chargeId: link.charge_id,
    linkId: link.id,
  };
}

// POST /api/webhooks/kkiapay — toujours répondre vite, KKiaPay retente sinon.
router.post('/kkiapay', async (req, res) => {
  try {
    const transactionId = extractTransactionId(req.body);
    const reference = extractReference(req.body);
    if (!transactionId || !reference) {
      logger.warn('Webhook KKiaPay : champs attendus absents du payload', { body: req.body });
      return res.status(200).json({ received: true });
    }

    const target = await resolveTarget(reference);
    if (!target) {
      logger.warn('Webhook KKiaPay : référence interne non résolue', { reference });
      return res.status(200).json({ received: true });
    }

    const headerSecret = req.get('x-kkiapay-secret');
    if (!kkiapay.verifyWebhookOrigin(target.tenant, headerSecret)) {
      logger.warn('Webhook KKiaPay : origine non vérifiée (secret invalide)', { tenantId: target.tenant.id });
      return res.status(200).json({ received: true });
    }

    await verifyAndRecordKkiapay({
      tenant: target.tenant,
      transactionId,
      kind: target.kind,
      leaseId: target.leaseId,
      chargeId: target.chargeId,
      linkId: target.linkId,
      // La référence QUE CE WEBHOOK affirme concerner, à recouper contre
      // celle que KKiaPay a réellement associée à la transaction à sa
      // création — sans ça, un tiers en possession d'un `transactionId` réel
      // (fuité ailleurs) pourrait forger un webhook avec une AUTRE référence
      // pour rediriger le crédit vers un bail/facture qui n'est pas le bon.
      expectedReference: reference,
    });
    res.status(200).json({ received: true });
  } catch (err) {
    // Ne jamais renvoyer une erreur 5xx pour un problème métier (ex. facture
    // déjà réglée) — KKiaPay retenterait indéfiniment. Uniquement journalisé.
    logger.error('Webhook KKiaPay : échec du traitement', { error: err.message });
    res.status(200).json({ received: true });
  }
});

module.exports = router;
