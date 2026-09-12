'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/env');

/**
 * Utilitaires JWT — configuration centralisée pour l'étape 0.
 * Les routes d'authentification (login / refresh) sont ajoutées à l'étape 2 ;
 * ici on ne fournit que la fabrique et la vérification des tokens.
 *
 * Convention de payload : { sub: userId, tenantId, role }
 */

function signAccessToken(payload) {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
    issuer: config.jwt.issuer,
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTtl,
    issuer: config.jwt.issuer,
  });
}

// Allowlist explicite : on ne signe qu'en HS256, on ne vérifie qu'en HS256
// (empêche toute confusion d'algorithme — étape 12, audit).
const VERIFY_OPTS = { issuer: config.jwt.issuer, algorithms: ['HS256'] };

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret, VERIFY_OPTS);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret, VERIFY_OPTS);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
