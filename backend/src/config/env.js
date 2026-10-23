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

// Audit du 2026-10-23 : le commentaire ci-dessous promettait déjà « pas de dégradation silencieuse
// en production » pour l'email, mais rien ne le vérifiait — `RESEND_API_KEY` manquant en prod
// laissait `resendClient.js` journaliser au lieu d'envoyer, exactement comme en dev, y compris pour
// le code de vérification d'inscription (sans lequel un compte ne peut jamais être activé). Même
// principe que `secret()` ci-dessus pour les secrets JWT : échec au démarrage plutôt qu'un incident
// silencieux en production.
function requiredInProd(name) {
  const value = process.env[name];
  if (!value && isProd) throw new Error(`Variable d'environnement manquante en production : ${name} (aucun email ne pourrait être envoyé)`);
  return value || '';
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
  // stocker les clés privée/secrète FedaPay de chaque entreprise de façon
  // récupérable (contrairement aux mots de passe/tokens, hashés à sens
  // unique partout ailleurs dans ce projet). Une seule clé globale : c'est
  // le serveur qui protège la base, pas une entreprise qui protège les
  // autres.
  secretsEncryptionKey: secret('SECRETS_ENCRYPTION_KEY'),

  // Assistant IA (Claude) — voir services/assistant/. La clé API n'est jamais
  // obligatoire : sans elle, l'assistant se déclare simplement « non configuré »
  // et le reste de la plateforme fonctionne à l'identique. Jamais loggée, jamais
  // renvoyée au front. Modèle réglable sans toucher au code (décision produit :
  // Claude Sonnet 5 au départ).
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-sonnet-5',
    // low | medium | high | xhigh | max — profondeur de réflexion (et donc coût/latence).
    effort: process.env.AI_EFFORT || 'low',
    maxTokens: int('AI_MAX_TOKENS', 2048),
    // Nombre de messages précédents renvoyés au modèle à chaque tour (l'API est sans mémoire).
    historyMessages: int('AI_HISTORY_MESSAGES', 12),
    // Conversations conservées au plus ce nombre de jours (purge opportuniste).
    retentionDays: int('AI_RETENTION_DAYS', 90),
  },

  // Email (Resend) — vérification d'email obligatoire à l'inscription du DG (demande
  // utilisateur, 2026-10-18) + email de bienvenue différé. Contrairement à l'assistant IA
  // ci-dessus, PAS de dégradation silencieuse en production (l'inscription ne pourrait plus
  // jamais être confirmée) — mais en dev/test, sans clé, `services/email/resendClient.js` se
  // contente de journaliser l'email au lieu de l'envoyer, pour ne jamais bloquer le
  // développement local ni la suite de tests sur un vrai appel réseau.
  email: {
    apiKey: requiredInProd('RESEND_API_KEY'),
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'service@cabinetmconseil.com',
  },
};

// Indicateurs de lancement du SaaS (voir SAAS_PLAN.md). Faux par défaut : le comportement actuel ne change pas
// tant qu'on ne les active pas explicitement.
config.features = {
  // Assistant IA : reporté à une version ultérieure. Faux = routes non montées, aucun bouton, aucun appel d'IA.
  assistant: process.env.ASSISTANT_FEATURE_ENABLED === 'true',
  // Abonnements appliqués (fonctions et limites par offre). Faux = toutes les entreprises se comportent comme « interne ».
  subscriptionsEnforced: process.env.SUBSCRIPTIONS_ENFORCED === 'true',
};

// Compte FedaPay DE LA PLATEFORME (encaisse les abonnements) — distinct des clés de chaque entreprise cliente.
config.platform = {
  adminEmail: process.env.PLATFORM_ADMIN_EMAIL || '', // reçoit les demandes de remboursement
  refundFeePercent: Number(process.env.PLATFORM_REFUND_FEE_PERCENT || 3), // estimation des frais FedaPay retenus (modifiable à la validation)
  fedapaySecretKey: process.env.PLATFORM_FEDAPAY_SECRET_KEY || '',
  fedapayWebhookSecret: process.env.PLATFORM_FEDAPAY_WEBHOOK_SECRET || '',
  fedapaySandbox: process.env.PLATFORM_FEDAPAY_SANDBOX !== 'false',
};

// Identité légale de la plateforme (factures, pages légales) et version des conditions d'utilisation en vigueur.
config.legal = {
  termsVersion: process.env.TERMS_VERSION || '2026-10',
  name: process.env.PLATFORM_LEGAL_NAME || 'Africa Immo Management',
  rccm: process.env.PLATFORM_LEGAL_RCCM || '',
  ifu: process.env.PLATFORM_LEGAL_IFU || '',
  address: process.env.PLATFORM_LEGAL_ADDRESS || '',
};

module.exports = config;
