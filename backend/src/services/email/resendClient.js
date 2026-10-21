'use strict';

/**
 * Point d'accès UNIQUE au SDK Resend. Aucune route ni aucun service ne l'instancie
 * ailleurs : la clé API ne circule qu'ici (jamais loggée, jamais renvoyée au front).
 * Même convention que `services/assistant/client.js` (lazy singleton + hook de test).
 */

const { Resend } = require('resend');
const config = require('../../config/env');

let client = null;

/** La clé est-elle renseignée ? (sans jamais l'exposer) */
function isConfigured() {
  return !!config.email.apiKey || client !== null;
}

/** Client Resend paresseux ; null si non configuré (jamais d'exception ici — voir sendEmail.js). */
function getClient() {
  if (client) return client;
  if (!config.email.apiKey) return null;
  client = new Resend(config.email.apiKey);
  return client;
}

/** Tests uniquement : injecte un faux client (jamais d'appel réseau, jamais de dépense). */
function setClientForTests(fake) {
  client = fake;
}

module.exports = { getClient, isConfigured, setClientForTests };
