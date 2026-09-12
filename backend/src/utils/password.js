'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config/env');

async function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Caractères sans ambiguïté visuelle (pas de 0/O, 1/l/I) : plus sûr à
// communiquer oralement ou par WhatsApp à un employé.
const TMP_LOWER = 'abcdefghjkmnpqrstuvwxyz';
const TMP_UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const TMP_DIGITS = '23456789';
const TMP_SPECIAL = '!@#$%*?-_';

function pick(charset) {
  return charset[crypto.randomInt(charset.length)];
}

/** Génère un mot de passe temporaire conforme à PASSWORD_RE (étape 3, création d'employé). */
function generateTemporaryPassword() {
  const all = TMP_LOWER + TMP_UPPER + TMP_DIGITS + TMP_SPECIAL;
  const chars = [
    pick(TMP_LOWER),
    pick(TMP_UPPER),
    pick(TMP_DIGITS),
    pick(TMP_SPECIAL),
    ...Array.from({ length: 8 }, () => pick(all)),
  ];
  // Mélange (Fisher-Yates) pour ne pas avoir les caractères obligatoires toujours en tête.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { hashPassword, verifyPassword, generateTemporaryPassword };
