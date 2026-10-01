'use strict';

/**
 * Bug corrigé (audit sécurité/logique, étape 49) : la purge des conversations
 * de l'assistant IA (`services/assistant/conversations.js` `purgeExpired`)
 * n'était déclenchée QU'en fin d'échange (`services/assistant/chat.js`), et
 * uniquement pour le tenant qui vient de discuter — un cabinet qui a discuté
 * une seule fois puis plus jamais gardait ses anciennes conversations
 * indéfiniment, bien au-delà du délai de conservation affiché
 * (`AI_RETENTION_DAYS`). Cette tâche balaie TOUS les cabinets chaque jour,
 * qu'ils aient discuté récemment ou non — la purge opportuniste reste en
 * place en complément (aucune régression si ce job tombe en panne un jour).
 */

const { pool } = require('../config/db');
const { purgeExpired } = require('../services/assistant/conversations');
const config = require('../config/env');
const logger = require('../utils/logger');

// `tenantIds` : uniquement pour les tests (cibler des cabinets jetables) — le
// planificateur l'appelle sans argument : tous les cabinets.
async function runAssistantPurgeJob({ tenantIds = null } = {}) {
  const tenants = tenantIds ? tenantIds.map((id) => ({ id })) : (await pool.query('SELECT id FROM tenants'))[0];

  for (const { id: tenantId } of tenants) {
    try {
      await purgeExpired(tenantId, config.ai.retentionDays);
    } catch (err) {
      logger.error("Échec de la purge planifiée des conversations de l'assistant IA", { tenantId, error: err.message });
    }
  }
}

module.exports = { runAssistantPurgeJob };
