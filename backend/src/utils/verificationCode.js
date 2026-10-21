'use strict';

/**
 * Code de vérification d'email à l'inscription (demande utilisateur, 2026-10-18) — 8 chiffres,
 * haché avec bcrypt avant stockage (même coût que les mots de passe, `config.bcryptRounds`) :
 * jamais en clair en base, contrairement au code de vérification PUBLIC des documents PDF
 * (`document_issuances`, non secret par conception — voir `utils/tokens.js`). bcrypt plutôt
 * qu'un simple SHA-256 : un code à 8 chiffres n'a que 10⁸ possibilités, un hash rapide le
 * rendrait cassable hors ligne en cas de fuite de la base ; bcrypt ralentit significativement
 * cette attaque, en plus de l'expiration (15 min) et du plafond de tentatives applicatif.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config/env');

function generateEmailVerificationCode() {
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
}

async function hashVerificationCode(code) {
  return bcrypt.hash(code, config.bcryptRounds);
}

async function verifyVerificationCode(code, hash) {
  return bcrypt.compare(code, hash);
}

// Même garde de temporisation que `DUMMY_PASSWORD_HASH` (utils/password.js) : comparé quand
// aucune vérification en attente ne correspond, pour que la réponse prenne le même temps que
// l'email existe ou non.
const DUMMY_CODE_HASH = bcrypt.hashSync('00000000', config.bcryptRounds);

module.exports = { generateEmailVerificationCode, hashVerificationCode, verifyVerificationCode, DUMMY_CODE_HASH };
