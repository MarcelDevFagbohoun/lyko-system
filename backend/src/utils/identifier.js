'use strict';

const crypto = require('crypto');

// Alphabet sans caractères ambigus (pas de 0/O, 1/I/L) : plus sûr à lire et
// à retaper depuis un message WhatsApp ou un email.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Génère un identifiant de connexion employé, ex. "7F3K-9QXM-2PTD" (12 caractères, minimum de sécurité : 10). */
function generateIdentifier() {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

module.exports = { generateIdentifier };
