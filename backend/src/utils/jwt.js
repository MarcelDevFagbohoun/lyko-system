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

// Back-office de la plateforme : clé DÉRIVÉE et distincte de celle des employés — un jeton employé ne peut jamais
// ouvrir le back-office, et inversement (séparation cryptographique, pas seulement un champ `role`).
const crypto = require('crypto');
function adminSecret() {
  return process.env.PLATFORM_ADMIN_JWT_SECRET || crypto.createHmac('sha256', config.jwt.accessSecret).update('lyko-platform-admin-v1').digest('hex');
}
function signAdminToken(payload) {
  return jwt.sign({ ...payload, realm: 'platform_admin' }, adminSecret(), { expiresIn: '8h', issuer: config.jwt.issuer });
}
function verifyAdminToken(token) {
  const p = jwt.verify(token, adminSecret(), { issuer: config.jwt.issuer, algorithms: ['HS256'] });
  if (p.realm !== 'platform_admin') throw new Error('realm');
  return p;
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

// Comptes du grand public sur Quick Immo (site externe séparé) — un seul
// token, sans rotation de refresh token (pas d'enjeu financier/sensible
// comparable aux comptes employé, une session longue simplifie le client
// public). Signé avec une clé DÉDIÉE (`marketplaceAccountSecret`, distincte
// de celle des employés) : une séparation cryptographique, pas seulement un
// indicateur applicatif — `verifyAccessToken` (employé) ne peut PAS vérifier
// avec succès un token de ce realm, même si son payload ressemblait à un
// payload employé (même `sub` numérique par coïncidence, etc.).
function signMarketplaceToken(payload) {
  return jwt.sign(payload, config.jwt.marketplaceAccountSecret, {
    expiresIn: '30d',
    issuer: config.jwt.issuer,
  });
}

function verifyMarketplaceToken(token) {
  return jwt.verify(token, config.jwt.marketplaceAccountSecret, VERIFY_OPTS);
}

module.exports = {
  signAdminToken,
  verifyAdminToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  signMarketplaceToken,
  verifyMarketplaceToken,
};
