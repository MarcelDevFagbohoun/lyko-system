'use strict';

const crypto = require('crypto');
const config = require('../../config/env');
const logger = require('../../utils/logger');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { getClient, Anthropic } = require('./client');
const { buildSystem } = require('./systemPrompt');
const { loadContext, assertCanChat } = require('./access');
const { recordUsage, getUsageSummary } = require('./usage');
const { recentMessages, appendExchange, purgeExpired } = require('./conversations');
const { resolvePropertyScope } = require('../scope');
const { toolsFor, labelFor, runTool } = require('./tools');

/**
 * Un tour de conversation : vérifie les droits, appelle Claude en flux continu — avec, pour un
 * utilisateur qui a accès à au moins un module de données (étape B), des outils de LECTURE qui
 * réutilisent les calculs déjà en place ailleurs sur la plateforme (voir `tools.js`) — transmet le
 * texte au fur et à mesure (`emit`), puis enregistre l'échange et la consommation.
 *
 * Invariants :
 *  - entreprise et utilisateur viennent du jeton, jamais du message ;
 *  - jamais de texte d'utilisateur ni de réponse dans les logs (données du cabinet) ;
 *  - le modèle ne touche JAMAIS la base : il appelle un outil par son nom, nous exécutons, seul le
 *    résultat (déjà filtré par les droits ET la portée agent) lui est renvoyé ;
 *  - la conversation ENREGISTRÉE ne garde que la question et la réponse finale — les allers-retours
 *    d'outils sont un espace de travail éphémère à ce tour, jamais persistés ;
 *  - on n'enregistre l'échange qu'une fois la réponse COMPLÈTE : un échec ne laisse pas de question orpheline ;
 *  - une seule réponse en cours par utilisateur (anti-inondation) ;
 *  - un nombre d'allers-retours d'outils borné (coût maîtrisé, jamais de boucle infinie).
 */

const inFlight = new Set();

const MAX_TOOL_ROUNDS = 4;
const MSG_TRUNCATED = '\n\n(Réponse coupée : demandez-moi de continuer.)';
const MSG_TOOL_LIMIT = "\n\n(Cette analyse demandait trop d'étapes : posez une question plus précise.)";
const MSG_REFUSED = 'Je ne peux pas répondre à cette demande.';
const MSG_EMPTY = "Je n'ai pas pu formuler de réponse. Pouvez-vous reformuler votre question ?";

/** Identifiant opaque transmis à l'API pour la détection d'abus : ni nom, ni téléphone, ni e-mail. */
function opaqueUserId(tenantId, userId) {
  return crypto.createHash('sha256').update(`lyko:${tenantId}:${userId}`).digest('hex').slice(0, 32);
}

/** Traduit une erreur du SDK en erreur présentable — jamais le message brut de l'API (peut révéler des détails). */
function toClientError(err) {
  if (err instanceof ApiError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    return new ApiError(429, 'Le service est très sollicité, réessayez dans un instant.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ApiError(503, "Connexion au service de l'assistant impossible. Réessayez dans un instant.");
  }
  if (err instanceof Anthropic.APIError) {
    // Clé invalide, crédit épuisé, requête refusée… : problème de configuration côté serveur, pas de l'utilisateur.
    logger.error('Assistant : erreur API', { status: err.status, type: err.name });
    return new ApiError(503, "L'assistant est momentanément indisponible.");
  }
  logger.error("Assistant : erreur inattendue", { type: err?.name });
  return new ApiError(500, "L'assistant a rencontré un problème.");
}

function addUsage(total, usage) {
  if (!usage) return total;
  total.input_tokens += usage.input_tokens ?? 0;
  total.output_tokens += usage.output_tokens ?? 0;
  total.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
  return total;
}

/**
 * @param {object} p
 * @param {{id:number, tenantId:number}} p.auth        identité issue du jeton
 * @param {string} p.message                            question de l'utilisateur (déjà validée)
 * @param {number|null} p.conversationId
 * @param {(event: {type: string, [k: string]: any}) => void} p.emit
 * @param {AbortSignal} [p.signal]                      annulé quand le navigateur se déconnecte
 */
async function runChat({ auth, message, conversationId = null, emit, signal }) {
  const key = `${auth.tenantId}:${auth.id}`;
  if (inFlight.has(key)) throw new ApiError(429, 'Une réponse est déjà en cours, patientez un instant.');
  inFlight.add(key);
  try {
    const ctx = await loadContext(auth);
    await assertCanChat(ctx);

    let history = [];
    if (conversationId) {
      const recent = await recentMessages(ctx.user.tenantId, ctx.user.id, conversationId, config.ai.historyMessages);
      if (recent === null) throw new ApiError(404, 'Conversation introuvable');
      history = recent;
    }

    // Outils de lecture (étape B) : filtrés par les droits ET la portée « Biens gérés » d'un agent
    // restreint — la même portée que verrait cette même personne sur les écrans habituels.
    const scopeAgentId = await resolvePropertyScope(ctx.user);
    const toolCtx = { tenantId: ctx.user.tenantId, userId: ctx.user.id, role: ctx.user.role, permissions: ctx.permissions, scopeAgentId };
    const tools = toolsFor(toolCtx);

    const client = getClient();
    const system = buildSystem({ user: ctx.user, tenant: ctx.tenant, permissions: ctx.permissions, profile: ctx.profile });
    let conversationMessages = [...history, { role: 'user', content: message }];

    let text = '';
    let final;
    let toolLimitHit = false;
    // Cumul sur TOUS les allers-retours d'outils de ce tour : chaque appel réel à l'API est facturé,
    // même quand un seul message compte dans le quota de conversation (voir plus bas).
    const usageTotal = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    for (let round = 0; ; round++) {
      const stream = client.messages.stream(
        {
          model: config.ai.model,
          max_tokens: config.ai.maxTokens,
          system,
          messages: conversationMessages,
          ...(tools.length > 0 ? { tools } : {}),
          output_config: { effort: config.ai.effort },
          metadata: { user_id: opaqueUserId(ctx.user.tenantId, ctx.user.id) },
        },
        { signal },
      );

      try {
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
            emit({ type: 'status', status: 'thinking' });
          } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            emit({ type: 'status', status: 'tool', label: labelFor(event.content_block.name) });
          } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            text += event.delta.text;
            emit({ type: 'delta', text: event.delta.text });
          }
        }
        final = await stream.finalMessage();
        addUsage(usageTotal, final.usage);
      } catch (err) {
        if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) {
          // Le navigateur est parti : ce qui a été généré est facturé, donc compté dans le quota — sans quoi
          // annuler serait un moyen de contourner la limite.
          await recordUsage(pool, { tenantId: ctx.user.tenantId, userId: ctx.user.id, model: config.ai.model, usage: null, outcome: 'aborted' });
          return null;
        }
        throw err;
      }

      // Nouveau tableau (jamais de mutation en place) : le client réel du SDK — et notre faux client de
      // test — reçoit la référence exacte passée à `messages`, qui ne doit jamais changer après coup.
      conversationMessages = [...conversationMessages, { role: 'assistant', content: final.content }];
      if (final.stop_reason !== 'tool_use') break;
      if (round + 1 >= MAX_TOOL_ROUNDS) {
        toolLimitHit = true;
        break;
      }

      const calls = final.content.filter((b) => b.type === 'tool_use');
      const results = await Promise.all(
        calls.map(async (call) => {
          try {
            const result = await runTool(toolCtx, call.name, call.input);
            // `runTool` ne lève jamais pour un outil refusé/inconnu — il renvoie `{ erreur: ... }` (voir
            // tools.js) : on le signale quand même au modèle comme un échec, pour qu'il n'insiste pas.
            const isError = !!(result && typeof result === 'object' && 'erreur' in result);
            return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result), ...(isError ? { is_error: true } : {}) };
          } catch (err) {
            logger.error('Assistant : échec outil', { tool: call.name, error: err?.message });
            return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify({ erreur: 'Donnée indisponible pour le moment.' }), is_error: true };
          }
        }),
      );
      conversationMessages = [...conversationMessages, { role: 'user', content: results }];
    }

    let outcome = 'ok';
    let reply = text;
    if (final.stop_reason === 'refusal') {
      outcome = 'refused';
      if (!reply.trim()) {
        reply = MSG_REFUSED;
        emit({ type: 'delta', text: reply });
      }
    } else if (final.stop_reason === 'max_tokens') {
      outcome = 'truncated';
      reply += MSG_TRUNCATED;
      emit({ type: 'delta', text: MSG_TRUNCATED });
    } else if (toolLimitHit) {
      outcome = 'truncated';
      reply += MSG_TOOL_LIMIT;
      emit({ type: 'delta', text: MSG_TOOL_LIMIT });
    }
    if (!reply.trim()) {
      reply = MSG_EMPTY;
      emit({ type: 'delta', text: reply });
    }

    const savedId = await appendExchange({
      tenantId: ctx.user.tenantId,
      userId: ctx.user.id,
      conversationId,
      userText: message,
      assistantText: reply,
    });
    // Un seul message côté quota même si l'assistant a fait plusieurs allers-retours d'outils — les
    // jetons de CHAQUE appel réel à l'API, eux, sont tous comptés dans `usageTotal` (coût réel).
    await recordUsage(pool, { tenantId: ctx.user.tenantId, userId: ctx.user.id, model: config.ai.model, usage: usageTotal, outcome });
    purgeExpired(ctx.user.tenantId, config.ai.retentionDays).catch(() => {});

    const usage = await getUsageSummary(ctx.user.tenantId);
    emit({ type: 'done', conversationId: savedId, usage: { used: usage.used, quota: usage.quota, remaining: usage.remaining } });
    return { conversationId: savedId, reply, outcome };
  } catch (err) {
    throw toClientError(err);
  } finally {
    inFlight.delete(key);
  }
}

module.exports = { runChat, toClientError, opaqueUserId };
