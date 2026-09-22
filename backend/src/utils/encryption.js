'use strict';

const crypto = require('crypto');
const config = require('../config/env');

// Chiffrement RÉVERSIBLE (AES-256-GCM) — contrairement à `hashToken()` dans
// `tokens.js`, qui protège des valeurs qu'on n'a jamais besoin de relire en
// clair (mots de passe, tokens de session/portail). Les clés privée/secrète
// KKiaPay de chaque entreprise doivent au contraire être RÉCUPÉRABLES en
// clair pour appeler leur API — d'où ce module distinct, à réserver à ce
// seul type de besoin (jamais pour un mot de passe : bcrypt reste la règle).
//
// `config.secretsEncryptionKey` est une chaîne arbitraire (pas forcément 32
// octets pile) : on en dérive une clé AES-256 de taille fixe via SHA-256,
// plutôt que d'exiger un format binaire précis dans la variable d'environnement.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // taille recommandée pour GCM

function derivedKey() {
  return crypto.createHash('sha256').update(config.secretsEncryptionKey).digest();
}

/** Chiffre une valeur en clair (ex. clé privée KKiaPay) → chaîne stockable telle quelle en base. */
function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv:authTag:ciphertext, chaque segment en base64 — un seul champ TEXT à stocker.
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Inverse de `encryptSecret` — lève si la valeur a été altérée (authTag GCM invalide). */
function decryptSecret(stored) {
  const [ivB64, authTagB64, dataB64] = String(stored).split(':');
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error('Valeur chiffrée mal formée');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
