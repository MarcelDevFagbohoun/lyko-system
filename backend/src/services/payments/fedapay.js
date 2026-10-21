'use strict';

const { decryptSecret } = require('../../utils/encryption');
const logger = require('../../utils/logger');

/**
 * Client FedaPay (Payouts) écrit à la main, sans SDK — même choix que `services/kkiapay.js` (aucune dépendance
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

function secretKeyFor(tenant) {
  if (!tenant.fedapay_enabled || !tenant.fedapay_secret_key_enc) {
    throw new ProviderError('Les paiements sortants ne sont pas activés pour cette entreprise.');
  }
  return decryptSecret(tenant.fedapay_secret_key_enc);
}

async function call(tenant, method, path, body) {
  const key = secretKeyFor(tenant);
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

module.exports = { createPayout, startPayout, getPayout, ProviderError, MODE_BY_OPERATOR };
