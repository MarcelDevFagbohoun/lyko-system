'use strict';

const { pool } = require('../../config/db');

/**
 * Consommation de l'assistant : une ligne par message envoyé au modèle. Le quota mensuel compte
 * ces lignes ; on n'y garde que des compteurs, jamais le texte échangé.
 *
 * Quota fixe pour toutes les entreprises (décision explicite de l'utilisateur, 2026-10-01) : réglé
 * en backend, jamais configurable par entreprise via l'interface/l'API (contrairement à avant).
 */
const MONTHLY_QUOTA = 150;

// Dérogation pour les tests uniquement (même principe que `setClientForTests` dans client.js) :
// évite de devoir envoyer 150 vrais messages pour tester l'épuisement du quota.
let quotaOverride = null;
function setQuotaForTests(n) {
  quotaOverride = n;
}

/** Messages consommés ce mois-ci + quota. */
async function getUsageSummary(tenantId, db = pool) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens
     FROM assistant_usage
     WHERE tenant_id = :tenantId AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
    { tenantId },
  );
  const quota = quotaOverride ?? MONTHLY_QUOTA;
  const used = Number(row.n);
  return {
    used,
    quota,
    remaining: Math.max(quota - used, 0),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheReadTokens: Number(row.cache_read_tokens),
  };
}

async function recordUsage(db, { tenantId, userId, model, usage, outcome }) {
  await db.query(
    `INSERT INTO assistant_usage (tenant_id, user_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, outcome)
     VALUES (:tenantId, :userId, :model, :input, :output, :cacheRead, :cacheWrite, :outcome)`,
    {
      tenantId,
      userId,
      model,
      input: usage?.input_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      cacheRead: usage?.cache_read_input_tokens ?? 0,
      cacheWrite: usage?.cache_creation_input_tokens ?? 0,
      outcome,
    },
  );
}

module.exports = { getUsageSummary, recordUsage, setQuotaForTests };
