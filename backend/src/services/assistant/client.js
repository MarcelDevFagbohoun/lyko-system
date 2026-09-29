'use strict';

/**
 * Point d'accès UNIQUE au SDK Anthropic. Aucune route ni aucun service ne l'instancie
 * ailleurs : la clé API ne circule qu'ici (jamais loggée, jamais renvoyée au front).
 */

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../../config/env');
const { ApiError } = require('../../middleware/error');

let client = null;

/** La clé est-elle renseignée ? (sans jamais l'exposer) */
function isConfigured() {
  return !!config.ai.apiKey || client !== null;
}

/** Client Anthropic paresseux ; 503 explicite si la clé n'est pas configurée. */
function getClient() {
  if (client) return client;
  if (!config.ai.apiKey) {
    throw new ApiError(503, "L'assistant n'est pas configuré sur ce serveur.");
  }
  // `maxRetries: 1` : un chat interactif ne doit pas attendre des minutes derrière des relances silencieuses.
  client = new Anthropic({ apiKey: config.ai.apiKey, maxRetries: 1, timeout: 120_000 });
  return client;
}

/** Tests uniquement : injecte un faux client (jamais d'appel réseau, jamais de dépense). */
function setClientForTests(fake) {
  client = fake;
}

module.exports = { getClient, isConfigured, setClientForTests, Anthropic };
