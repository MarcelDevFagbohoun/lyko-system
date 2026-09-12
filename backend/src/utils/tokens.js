'use strict';

const crypto = require('crypto');

/** Empreinte stockée en base pour les refresh tokens (jamais le JWT en clair). */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Token du portail locataire : 256 bits d'aléa, encodage URL-safe — donné en
 * clair une seule fois (dans le lien transmis via WhatsApp), seule son
 * empreinte `hashToken()` est conservée en base (même principe que les
 * refresh tokens).
 */
function generatePortalToken() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = { hashToken, generatePortalToken };
