'use strict';

const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { getPermissions } = require('../permissions');
const { isConfigured } = require('./client');
const { getUsageSummary } = require('./usage');
const { getProfile } = require('./profile');
const { resolveRoleLabels } = require('../../constants/roles');

/** Clé de permission qui ouvre l'assistant à un employé (la direction y a toujours accès). */
const ASSISTANT_PERMISSION = 'assistant';

/**
 * Contexte d'accès d'un utilisateur : entreprise, utilisateur, droits — TOUJOURS relu en base à partir du
 * jeton (jamais depuis le corps de la requête ni depuis un message du chat).
 */
async function loadContext(auth) {
  const [[row]] = await pool.query(
    `SELECT u.id AS user_id, u.first_name, u.role, u.status,
            t.id AS tenant_id, t.company_name, t.dg_title, t.comptable_title, t.agent_title,
            t.assistant_enabled, t.assistant_consent_at
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = :userId AND u.tenant_id = :tenantId LIMIT 1`,
    { userId: auth.id, tenantId: auth.tenantId },
  );
  if (!row) throw new ApiError(401, 'Session invalide');
  const permissions = await getPermissions(row.user_id, row.role);
  const profile = await getProfile(row.tenant_id, row.user_id);
  return {
    user: { id: row.user_id, tenantId: row.tenant_id, role: row.role, firstName: row.first_name, active: row.status === 'active' },
    tenant: {
      id: row.tenant_id,
      company_name: row.company_name,
      dg_title: row.dg_title,
      comptable_title: row.comptable_title,
      agent_title: row.agent_title,
    },
    enabled: !!row.assistant_enabled,
    consentAt: row.assistant_consent_at,
    permissions,
    profile,
  };
}

/** Raison pour laquelle l'assistant n'est pas utilisable, ou null s'il l'est. */
function blockReason(ctx) {
  if (!ctx.user.active) return 'not_permitted';
  if (!ctx.enabled) return 'disabled';
  if (ctx.user.role !== 'dg' && !ctx.permissions.includes(ASSISTANT_PERMISSION)) return 'not_permitted';
  if (!isConfigured()) return 'not_configured';
  return null;
}

const REASON_MESSAGES = {
  disabled: "L'assistant n'est pas activé pour votre entreprise.",
  not_permitted: "Vous n'avez pas accès à l'assistant.",
  not_configured: "L'assistant n'est pas configuré sur ce serveur.",
};
const REASON_STATUS = { disabled: 403, not_permitted: 403, not_configured: 503 };

/** Lève l'erreur adaptée si l'utilisateur ne peut pas utiliser l'assistant (activation, droit, clé, quota). */
async function assertCanChat(ctx) {
  const reason = blockReason(ctx);
  if (reason) throw new ApiError(REASON_STATUS[reason], REASON_MESSAGES[reason]);
  const usage = await getUsageSummary(ctx.user.tenantId);
  if (usage.remaining <= 0) {
    throw new ApiError(429, `Le quota mensuel de l'assistant (${usage.quota} messages) est atteint pour votre entreprise.`);
  }
  return usage;
}

/** Ce que le front a besoin de savoir pour afficher (ou non) le bouton de l'assistant. */
async function getStatus(auth) {
  const ctx = await loadContext(auth);
  const reason = blockReason(ctx);
  const usage = await getUsageSummary(ctx.user.tenantId);
  const status = { available: reason === null, reason, usage: { used: usage.used, quota: usage.quota, remaining: usage.remaining } };
  if (reason === null) {
    // Profil mémorisé (null = jamais renseigné → le panneau propose de faire connaissance) + de quoi pré-remplir.
    status.profile = await getProfile(ctx.user.tenantId, ctx.user.id);
    status.suggestions = {
      displayName: ctx.user.firstName ?? '',
      jobTitle: resolveRoleLabels(ctx.tenant)[ctx.user.role] ?? '',
    };
  }
  return status;
}

module.exports = { ASSISTANT_PERMISSION, loadContext, blockReason, assertCanChat, getStatus };
