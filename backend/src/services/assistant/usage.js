'use strict';

const { pool } = require('../../config/db');

/**
 * Consommation de l'assistant : une ligne par message envoyé au modèle. Le quota mensuel du
 * cabinet compte ces lignes ; on n'y garde que des compteurs, jamais le texte échangé.
 */

/** Messages consommés ce mois-ci + quota du cabinet. */
async function getUsageSummary(tenantId, db = pool) {
  const [[tenant]] = await db.query('SELECT assistant_monthly_quota FROM tenants WHERE id = :tenantId LIMIT 1', { tenantId });
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens
     FROM assistant_usage
     WHERE tenant_id = :tenantId AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
    { tenantId },
  );
  const quota = Number(tenant?.assistant_monthly_quota ?? 0);
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

module.exports = { getUsageSummary, recordUsage };
