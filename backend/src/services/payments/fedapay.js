'use strict';

const { decryptSecret } = require('../../utils/encryption');
const logger = require('../../utils/logger');

/**
 * Client FedaPay (Payouts) écrit à la main, sans SDK — même principe que l’ancien client de paiement (aucune dépendance
 * supplémentaire à auditer). Seul endroit qui manipule la clé secrète en clair ; rien d'autre ne l'appelle.
 *
 * Endpoints (documentation FedaPay, « Payouts management ») :
 *   POST /v1/payouts         crée un paiement sortant (statut `pending`)
 *   PUT  /v1/payouts/start   l'envoie (immédiatement si pas de `scheduled_at`)
 *   GET  /v1/payouts/{id}    relit son état : `pending` | `started` | `processing` | `sent` | `failed`
 * Authentification : `Authorization: Bearer <clé secrète>`.
 *
 * À CONFIRMER lors du premier essai en sandbox réel (non testable ici sans compte) : la valeur exacte de `mode`
 * pour Moov Bénin, et l'enveloppe JSON des réponses (gérée défensivement ci-dessous).
 */
const BASE = { sandbox: 'https://sandbox-api.fedapay.com', live: 'https://api.fedapay.com' };
const MODE_BY_OPERATOR = { mtn: 'mtn_open', moov: 'moov' };
const TIMEOUT_MS = 15000;

class ProviderError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** `scope` : 'payout' (envois) ou 'collect' (encaissement) — deux interrupteurs indépendants, une même clé. */
function secretKeyFor(tenant, scope = 'payout') {
  const enabled = scope === 'collect' ? tenant.fedapay_collect_enabled : tenant.fedapay_enabled;
  if (!enabled || !tenant.fedapay_secret_key_enc) {
    throw new ProviderError(
      scope === 'collect'
        ? "Le paiement en ligne n'est pas activé pour cette entreprise."
        : 'Les paiements sortants ne sont pas activés pour cette entreprise.',
    );
  }
  return decryptSecret(tenant.fedapay_secret_key_enc);
}

async function call(tenant, method, path, body, scope = 'payout') {
  const key = secretKeyFor(tenant, scope);
  const base = tenant.fedapay_sandbox ? BASE.sandbox : BASE.live;
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Ne jamais inclure la requête (contient des données personnelles) ni la clé dans l'erreur.
    throw new ProviderError('FedaPay injoignable', { retryable: true });
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    // Corps de l'erreur journalisé tronqué, jamais renvoyé tel quel au client (peut contenir des détails internes).
    logger.warn('FedaPay a refusé la requête', { status: response.status, path, message: String(data?.message ?? '').slice(0, 160) });
    throw new ProviderError(`FedaPay a refusé la requête (HTTP ${response.status})`, {
      status: response.status,
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  return data;
}

/** Les réponses FedaPay enveloppent l'objet (`{"v1/payout": {...}}`) ; gère aussi un objet nu ou une liste. */
function unwrapPayout(data) {
  if (!data || typeof data !== 'object') return null;
  const candidate = data['v1/payout'] ?? data.payout ?? (Array.isArray(data['v1/payouts']) ? data['v1/payouts'][0] : null) ?? data;
  return candidate && typeof candidate === 'object' && candidate.id != null ? candidate : null;
}

function splitName(fullName) {
  const parts = String(fullName).trim().split(/\s+/);
  return { firstname: parts[0] || 'Beneficiaire', lastname: parts.slice(1).join(' ') || parts[0] || 'Beneficiaire' };
}

async function createPayout(tenant, { amount, name, email, phone, operator, description, reference }) {
  const { firstname, lastname } = splitName(name);
  const data = await call(tenant, 'POST', '/v1/payouts', {
    amount: Number(amount),
    currency: { iso: 'XOF' },
    mode: MODE_BY_OPERATOR[operator],
    description: String(description).slice(0, 190),
    customer: {
      firstname,
      lastname,
      ...(email ? { email } : {}),
      phone_number: { number: phone, country: 'bj' },
    },
    custom_metadata: { lyko_reference: reference },
  });
  const payout = unwrapPayout(data);
  if (!payout) throw new ProviderError('Réponse FedaPay inattendue à la création');
  return { id: String(payout.id), status: String(payout.status ?? 'pending') };
}

async function startPayout(tenant, payoutId) {
  const data = await call(tenant, 'PUT', '/v1/payouts/start', { payouts: [{ id: Number(payoutId) }] });
  const payout = unwrapPayout(data);
  return { status: payout ? String(payout.status ?? 'started') : 'started' };
}

/** Relit l'état RÉEL du paiement chez FedaPay — seule source de vérité du statut. */
async function getPayout(tenant, payoutId) {
  const data = await call(tenant, 'GET', `/v1/payouts/${encodeURIComponent(String(payoutId))}`);
  const payout = unwrapPayout(data);
  if (!payout) throw new ProviderError('Réponse FedaPay inattendue à la lecture');
  return {
    id: String(payout.id),
    status: String(payout.status ?? ''),
    amount: payout.amount != null ? Number(payout.amount) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Encaissement (Checkout hébergé) : POST /v1/transactions → POST /v1/transactions/{id}/token → redirection vers
// `url`. Statuts : pending | approved | declined | canceled | refunded | transferred | expired.
// ---------------------------------------------------------------------------------------------------------
function unwrapTransaction(data) {
  if (!data || typeof data !== 'object') return null;
  const candidate = data['v1/transaction'] ?? data.transaction ?? data;
  return candidate && typeof candidate === 'object' && candidate.id != null ? candidate : null;
}

async function createCheckout(tenant, { amount, description, callbackUrl, reference, customer }) {
  const { firstname, lastname } = splitName(customer?.name || 'Client');
  const data = await call(tenant, 'POST', '/v1/transactions', {
    description: String(description).slice(0, 190),
    amount: Number(amount),
    currency: { iso: 'XOF' },
    callback_url: callbackUrl,
    custom_metadata: { lyko_reference: reference },
    customer: { firstname, lastname, ...(customer?.email ? { email: customer.email } : {}) },
  }, 'collect');
  const tx = unwrapTransaction(data);
  if (!tx) throw new ProviderError('Réponse FedaPay inattendue à la création de la transaction');
  const tokenData = await call(tenant, 'POST', `/v1/transactions/${encodeURIComponent(String(tx.id))}/token`, undefined, 'collect');
  const url = typeof tokenData?.url === 'string' ? tokenData.url : null;
  // On n'envoie jamais le client vers une adresse qui ne serait pas FedaPay.
  if (!url || !/^https:\/\/([a-z0-9-]+\.)*fedapay\.com(\/|$)/i.test(url)) {
    throw new ProviderError('Réponse FedaPay inattendue (adresse de paiement)');
  }
  return { transactionId: String(tx.id), url };
}

/** Relit l'état RÉEL d'une transaction — seule source de vérité d'un encaissement. */
async function getTransaction(tenant, transactionId) {
  const data = await call(tenant, 'GET', `/v1/transactions/${encodeURIComponent(String(transactionId))}`, undefined, 'collect');
  const tx = unwrapTransaction(data);
  if (!tx) throw new ProviderError('Réponse FedaPay inattendue à la lecture de la transaction');
  const meta = tx.custom_metadata && typeof tx.custom_metadata === 'object' ? tx.custom_metadata : {};
  return {
    id: String(tx.id),
    status: String(tx.status ?? ''),
    amount: tx.amount != null ? Number(tx.amount) : null,
    reference: typeof meta.lyko_reference === 'string' ? meta.lyko_reference : null,
  };
}

/**
 * Signature d'un webhook FedaPay : en-tête `X-FEDAPAY-SIGNATURE: t=<horodatage>,s=<hmac-sha256 hex>`, calculée sur
 * `<t>.<corps brut>` avec le secret du webhook. Comparaison à temps constant, tolérance de 10 minutes (rejeu).
 */
function verifyWebhookSignature(tenant, rawBody, header, { now = Date.now() } = {}) {
  if (!tenant.fedapay_webhook_secret_enc || !rawBody || typeof header !== 'string') return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')).filter((kv) => kv.length === 2));
  const t = parts.t;
  const sig = parts.s;
  if (!t || !sig || !/^\d{9,13}$/.test(t) || !/^[a-f0-9]{64}$/i.test(sig)) return false;
  const tsMs = t.length <= 10 ? Number(t) * 1000 : Number(t);
  if (Math.abs(now - tsMs) > 10 * 60 * 1000) return false;
  const secret = decryptSecret(tenant.fedapay_webhook_secret_enc);
  const expected = require('crypto').createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest();
  const given = Buffer.from(sig, 'hex');
  return given.length === expected.length && require('crypto').timingSafeEqual(given, expected);
}

module.exports = { createPayout, startPayout, getPayout, createCheckout, getTransaction, verifyWebhookSignature, ProviderError, MODE_BY_OPERATOR };
