'use strict';

/**
 * Droits d'une entreprise selon son abonnement : fonctions disponibles et limites (unités, propriétaires, utilisateurs).
 * Tant que SUBSCRIPTIONS_ENFORCED n'est pas activé, toute entreprise se comporte comme « interne » (accès complet) :
 * le comportement actuel ne change pas. Appliqué CÔTÉ SERVEUR uniquement — masquer un bouton ne protège de rien.
 */

const config = require('../config/env');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { getPlanAsync } = require('./planCatalog');
const { verifyAccessToken } = require('../utils/jwt');

const COUNTERS = {
  // Unités actives (hors biens supprimés) de l'entreprise.
  units: "SELECT COUNT(*) AS n FROM property_units WHERE tenant_id = :tenantId",
  // Propriétaires dont le mandat est en cours.
  owners: 'SELECT COUNT(*) AS n FROM owners WHERE tenant_id = :tenantId AND mandate_ended_at IS NULL',
  // Utilisateurs actifs (DG compris).
  users: "SELECT COUNT(*) AS n FROM users WHERE tenant_id = :tenantId AND status = 'active'",
};
const LABELS = { units: 'unités', owners: 'propriétaires', users: 'utilisateurs' };

function q(conn) {
  return conn || pool;
}

// L'échéance est comparée par MySQL (NOW()) : même horloge que celle qui l'a écrite, quel que soit le fuseau du serveur.
/** Droits courants : { planKey, status, active, features:Set, limits }. Un abonnement expiré/absent => active=false. */
async function getEntitlements(tenantId, conn) {
  if (!config.features.subscriptionsEnforced) {
    const p = await getPlanAsync('interne');
    return { planKey: 'interne', status: 'active', active: true, features: new Set(p.features), limits: p.limits, enforced: false };
  }
  const [rows] = await q(conn).query(
    'SELECT plan_key, status, (current_period_end IS NOT NULL AND current_period_end > NOW()) AS not_expired FROM tenant_subscriptions WHERE tenant_id = :tenantId',
    { tenantId },
  );
  const s = rows[0];
  const plan = s && s.plan_key ? await getPlanAsync(s.plan_key) : null;
  const notExpired = s && (s.plan_key === 'interne' || Number(s.not_expired) === 1);
  const active = !!(plan && s.status === 'active' && notExpired);
  return {
    planKey: s?.plan_key ?? null,
    status: s?.status ?? 'none',
    active,
    features: new Set(active ? plan.features : []),
    limits: active ? plan.limits : { units: 0, owners: 0, users: 0 },
    enforced: true,
  };
}

async function assertFeature(tenantId, feature, conn) {
  const ent = await getEntitlements(tenantId, conn);
  if (!ent.active) throw new ApiError(402, "Abonnement inactif ou expiré : renouvelez votre abonnement pour continuer.", { code: 'SUBSCRIPTION_INACTIVE' });
  if (!ent.features.has(feature)) {
    throw new ApiError(403, "Cette fonction n'est pas incluse dans votre offre. Passez à une offre supérieure.", { code: 'FEATURE_NOT_IN_PLAN', feature });
  }
  return ent;
}

/** Middleware : exige une fonction de l'offre (après requireAuth). */
function requireFeature(feature) {
  return (req, _res, next) => {
    assertFeature(req.user.tenantId, feature).then(() => next(), next);
  };
}

/**
 * Vérifie qu'ajouter `adding` éléments reste dans la limite. À appeler DANS la transaction de création, `conn` en
 * paramètre : le verrou FOR UPDATE sur la ligne d'abonnement sérialise les créations concurrentes (sinon deux requêtes
 * simultanées passeraient toutes deux sous la limite).
 */
async function assertWithinLimit(tenantId, kind, conn, adding = 1) {
  if (!config.features.subscriptionsEnforced) return;
  if (!conn) throw new Error('assertWithinLimit: transaction requise');
  await conn.query('SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id = :tenantId FOR UPDATE', { tenantId });
  const ent = await getEntitlements(tenantId, conn);
  if (!ent.active) throw new ApiError(402, "Abonnement inactif ou expiré : renouvelez votre abonnement pour continuer.", { code: 'SUBSCRIPTION_INACTIVE' });
  const max = ent.limits[kind];
  if (max === null || max === undefined) return;
  const [[row]] = await conn.query(COUNTERS[kind], { tenantId });
  if (Number(row.n) + adding > max) {
    throw new ApiError(403, `Limite de votre offre atteinte : ${max} ${LABELS[kind]} maximum. Passez à une offre supérieure.`, { code: 'PLAN_LIMIT_REACHED', kind, max });
  }
}

// Routes qui restent ouvertes à une entreprise sans abonnement actif (renouvellement, connexion, pages publiques).
const OPEN_PREFIXES = ['/health', '/auth', '/billing', '/admin', '/portal', '/owner-portal', '/marketplace-accounts', '/verify', '/pay', '/recu', '/online-payments', '/webhooks', '/marketplace/public'];

/**
 * Coupure CÔTÉ SERVEUR : toute requête authentifiée d'une entreprise dont l'abonnement n'est pas actif reçoit 402.
 * Placé en tête du routeur API ; sans jeton valide la requête passe et c'est la route elle-même qui répondra 401.
 */
function enforceActiveSubscription(req, _res, next) {
  if (!config.features.subscriptionsEnforced) return next();
  if (OPEN_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return next();
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (_e) {
    return next();
  }
  if (!payload.tenantId) return next();
  getEntitlements(payload.tenantId).then((ent) => {
    if (ent.active) return next();
    next(new ApiError(402, "Abonnement inactif ou expiré : renouvelez votre abonnement pour continuer.", { code: 'SUBSCRIPTION_INACTIVE' }));
  }, next);
}

/** Ids des entreprises dont l'abonnement est actif (toutes si les abonnements ne sont pas appliqués). */
async function listActiveTenantIds() {
  if (!config.features.subscriptionsEnforced) {
    const [rows] = await pool.query('SELECT id FROM tenants');
    return rows.map((r) => r.id);
  }
  const [rows] = await pool.query(
    `SELECT s.tenant_id AS id FROM tenant_subscriptions s
     WHERE s.status = 'active' AND (s.plan_key = 'interne' OR s.current_period_end > NOW())`,
  );
  return rows.map((r) => r.id);
}

/** Ligne d'abonnement initiale d'une nouvelle entreprise (dans la transaction d'inscription). */
async function createInitialSubscription(conn, tenantId) {
  if (config.features.subscriptionsEnforced) {
    await conn.query("INSERT INTO tenant_subscriptions (tenant_id, plan_key, status) VALUES (:tenantId, NULL, 'pending_payment')", { tenantId });
  } else {
    await conn.query("INSERT INTO tenant_subscriptions (tenant_id, plan_key, status) VALUES (:tenantId, 'interne', 'active')", { tenantId });
  }
}

module.exports = { listActiveTenantIds, enforceActiveSubscription, getEntitlements, assertFeature, requireFeature, assertWithinLimit, createInitialSubscription };
