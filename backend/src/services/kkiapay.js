'use strict';

const crypto = require('crypto');
const { decryptSecret } = require('../utils/encryption');

// Client KKiaPay minimal, écrit à la main plutôt que de dépendre du SDK
// officiel `@kkiapay-org/nodejs-sdk` : ce paquet embarque axios^0.27.2, qui
// traîne une longue liste de CVE connues (SSRF, pollution de prototype,
// fuite d'identifiants) pour ne wrapper que deux appels HTTP triviaux. On
// utilise `fetch` natif (Node 18+) à la place — même comportement, zéro
// dépendance supplémentaire.
//
// Endpoints et en-têtes confirmés en lisant la source du SDK officiel
// (https://github.com/asaje379/nodejs-sdk) : `x-api-key`/`x-secret-key`/
// `x-private-key`, POST `/api/v1/transactions/status` avec `{ transactionId }`.
const KKIAPAY_BASE = { sandbox: 'https://api-sandbox.kkiapay.me', live: 'https://api.kkiapay.me' };

/** Aucune route n'appelle directement l'API KKiaPay — tout passe par ici, seul endroit qui manipule des clés en clair. */
function credentialsFor(tenant) {
  if (!tenant.kkiapay_enabled) {
    throw new Error('KKiaPay désactivé pour cette entreprise');
  }
  return {
    publicKey: tenant.kkiapay_public_key,
    privateKey: decryptSecret(tenant.kkiapay_private_key_enc),
    secretKey: decryptSecret(tenant.kkiapay_secret_key_enc),
    sandbox: !!tenant.kkiapay_sandbox,
  };
}

/**
 * Revérifie une transaction CÔTÉ SERVEUR auprès de KKiaPay — règle non
 * négociable de leur propre documentation : un événement « succès » reçu du
 * widget client ou d'un webhook n'est qu'un SIGNAL, jamais une preuve (le
 * client peut mentir). Rien n'est enregistré tant que cet appel ne confirme
 * pas explicitement `status === 'SUCCESS'`.
 */
async function verifyTransaction(tenant, transactionId) {
  const { publicKey, privateKey, secretKey, sandbox } = credentialsFor(tenant);
  const base = sandbox ? KKIAPAY_BASE.sandbox : KKIAPAY_BASE.live;

  let response;
  try {
    response = await fetch(`${base}/api/v1/transactions/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': publicKey,
        'x-secret-key': secretKey,
        'x-private-key': privateKey,
      },
      body: JSON.stringify({ transactionId }),
    });
  } catch (err) {
    throw new Error(`KKiaPay injoignable : ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(`KKiaPay a refusé la vérification (HTTP ${response.status})`);
  }

  const data = await response.json();
  return {
    success: data.status === 'SUCCESS',
    status: data.status,
    amount: data.amount != null ? Number(data.amount) : null,
    raw: data,
  };
}

/**
 * Compare le secret reçu dans l'en-tête `x-kkiapay-secret` d'un webhook au
 * secret configuré par l'entreprise concernée — confirme que l'événement
 * vient bien de KKiaPay et pas d'un tiers qui devinerait l'URL du webhook.
 */
function verifyWebhookOrigin(tenant, headerSecret) {
  if (!headerSecret || !tenant.kkiapay_secret_key_enc) return false;
  const expected = decryptSecret(tenant.kkiapay_secret_key_enc);
  // Comparaison à temps constant — évite qu'un attaquant déduise le secret
  // octet par octet via le temps de réponse (même précaution que pour un mot
  // de passe, bien que le risque soit ici plus théorique que pratique).
  const a = Buffer.from(String(headerSecret));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyTransaction, verifyWebhookOrigin };
