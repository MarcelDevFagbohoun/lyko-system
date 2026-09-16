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

// Alphabet sans caractères ambigus à la relecture manuelle (0/O, 1/I/L) —
// ce code est destiné à être RETRANSCRIT par un humain depuis un PDF vers
// une page de vérification, contrairement aux tokens de portail ci-dessus
// (jamais tapés à la main). Pas un secret à protéger comme un mot de passe
// (n'importe qui recevant le document légitimement doit pouvoir vérifier),
// mais ~60 bits d'aléa sur 12 caractères empêchent toute énumération
// pratique d'un code valide au hasard.
const VERIFICATION_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Code de vérification imprimé sur une quittance/attestation/relevé — voir `document_issuances`. */
function generateVerificationCode() {
  const bytes = crypto.randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i += 1) {
    raw += VERIFICATION_ALPHABET[bytes[i] % VERIFICATION_ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

module.exports = { hashToken, generatePortalToken, generateVerificationCode };
