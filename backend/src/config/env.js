'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Charge backend/.env quel que soit le répertoire de lancement.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/** @param {string} name @param {string} [fallback] */
function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Variable d'environnement manquante : ${name} (voir backend/.env.example)`);
  }
  return value;
}

/** @param {string} name @param {number} fallback */
function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Variable d'environnement invalide (entier attendu) : ${name}`);
  return parsed;
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

// En production, aucun secret par défaut n'est toléré. Seuil relevé à 32
// caractères à l'étape 12 (audit) — un `openssl rand -base64 48` en fait 64.
function secret(name) {
  const value = process.env[name];
  if (!value || value.length < 32) {
    if (isProd) throw new Error(`Secret JWT trop faible ou absent : ${name} (min. 32 caractères — voir « openssl rand -base64 48 »)`);
    return `dev-insecure-${name}-padding-to-32-characters`;
  }
  return value;
}

const config = {
  nodeEnv: NODE_ENV,
  isProd,
  port: int('PORT', 4000),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // URL publique de l'application principale (pas Quick Immo) — utilisée
  // pour imprimer l'adresse de la page de vérification de document (étape
  // 29) sur les PDF ; jamais pour rediriger/appeler quoi que ce soit.
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, ''),

  db: {
    host: required('DB_HOST', '127.0.0.1'),
    port: int('DB_PORT', 3306),
    user: required('DB_USER', 'root'),
    password: process.env.DB_PASSWORD ?? '',
    database: required('DB_NAME', 'lyko_system'),
    connectionLimit: int('DB_CONNECTION_LIMIT', 10),
  },

  jwt: {
    accessSecret: secret('JWT_ACCESS_SECRET'),
    refreshSecret: secret('JWT_REFRESH_SECRET'),
    // Comptes Quick Immo (grand public, site externe séparé) : une clé
    // DÉDIÉE, jamais celle des employés — un token de ce realm ne doit pas
    // pouvoir être vérifié avec succès par `verifyAccessToken` (employé),
    // même si son payload portait par erreur un `role` qui ressemble à un
    // rôle employé. Séparation cryptographique, pas juste un indicateur
    // applicatif qu'on pourrait oublier de vérifier partout.
    marketplaceAccountSecret: secret('JWT_MARKETPLACE_ACCOUNT_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
    issuer: process.env.JWT_ISSUER || 'lyko-system',
  },

  bcryptRounds: int('BCRYPT_ROUNDS', 12),

  // Chiffrement réversible (AES-256-GCM, voir utils/encryption.js) — sert à
  // stocker les clés privée/secrète KKiaPay de chaque entreprise de façon
  // récupérable (contrairement aux mots de passe/tokens, hashés à sens
  // unique partout ailleurs dans ce projet). Une seule clé globale : c'est
  // le serveur qui protège la base, pas une entreprise qui protège les
  // autres.
  secretsEncryptionKey: secret('SECRETS_ENCRYPTION_KEY'),
};

module.exports = config;
