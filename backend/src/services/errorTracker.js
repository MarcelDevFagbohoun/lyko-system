'use strict';

/**
 * Suivi des erreurs de la plateforme (demande utilisateur, 2026-11-13) : enregistre chaque erreur
 * inattendue dans `platform_error_events` (migration 153) pour l'afficher dans le back-office
 * (onglet « Erreurs », routes/admin.js), et prévient l'administrateur par e-mail quand une erreur
 * NOUVELLE apparaît (ou qu'une erreur marquée corrigée revient).
 *
 * Règles :
 * - JAMAIS bloquant ni levant : une panne du suivi ne doit pas aggraver l'erreur d'origine.
 * - Regroupement par empreinte : même type, même message (chiffres neutralisés), même endroit
 *   → une seule ligne dont le compteur augmente.
 * - Aucune donnée métier : ni corps de requête, ni paramètres d'URL, ni jeton de portail.
 */

const crypto = require('crypto');
const { pool } = require('../config/db');
const config = require('../config/env');
const logger = require('../utils/logger');

const KINDS = new Set(['api', 'job', 'process', 'frontend']);
// Délai minimal entre deux e-mails pour une MÊME erreur qui revient après avoir été marquée corrigée.
const REALERT_AFTER_HOURS = 6;
// Plafond d'erreurs navigateur ouvertes : la route de signalement est publique, ce plafond empêche
// de remplir la table en variant artificiellement les messages.
const MAX_OPEN_FRONTEND_EVENTS = 300;

function clip(value, max) {
  const s = String(value ?? '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** « /api/renters/42/leases/7?x=1 » → « /api/renters/:id/leases/:id » : jamais d'identifiant, de jeton ni de paramètre. */
function normalizePath(rawPath) {
  const path = String(rawPath || '').split('?')[0].split('#')[0];
  return path
    .split('/')
    .map((seg, i, all) => {
      if (/^\d+$/.test(seg)) return ':id';
      // Jeton de portail (lien secret) et toute valeur longue opaque.
      if (['portal', 'owner-portal'].includes(all[i - 1])) return ':token';
      if (seg.length >= 20 && /^[A-Za-z0-9_-]+$/.test(seg)) return ':token';
      // Suffixe aléatoire des fichiers téléversés (« stamp-9f8a7b….png ») : même erreur, une seule ligne.
      return seg.replace(/-[0-9a-f]{8,}(?=\.|$)/i, '-:rand');
    })
    .join('/')
    .slice(0, 200);
}

/** Première ligne de la pile qui pointe vers NOTRE code (pas node_modules ni Node lui-même). */
function topAppFrame(stack) {
  const line = String(stack || '')
    .split('\n')
    .find((l) => l.includes('/src/') && !l.includes('node_modules'));
  return line ? line.trim().replace(/^at\s+/, '').replace(/:\d+:\d+\)?$/, '') : '';
}

function fingerprintOf({ kind, message, location, stack }) {
  const normalizedMessage = String(message).replace(/\d+/g, 'N').slice(0, 200);
  return crypto.createHash('sha1').update([kind, normalizedMessage, location || '', topAppFrame(stack)].join('|')).digest('hex');
}

async function alertAdmin({ kind, message, location, tenantId, reopened }) {
  if (!config.platform.adminEmail || process.env.NODE_ENV === 'test') return;
  // Import tardif : le module e-mail charge la configuration Resend, inutile tant qu'aucune alerte ne part.
  const { sendBillingEmail } = require('./email/sendEmail');
  const kindLabel = { api: 'Erreur serveur', job: 'Tâche planifiée en échec', process: 'Erreur interne', frontend: 'Écran en erreur' }[kind];
  await sendBillingEmail({
    to: config.platform.adminEmail,
    subject: `${reopened ? 'Erreur de retour' : 'Nouvelle erreur'} — ${kindLabel}`,
    heading: reopened ? 'Une erreur marquée corrigée est revenue' : 'Une nouvelle erreur vient d’apparaître',
    paragraphs: [
      `${kindLabel} : ${message}`,
      location ? `Où : ${location}` : null,
      tenantId ? `Entreprise concernée : n° ${tenantId}` : null,
      'Le détail (pile d’appels, nombre d’occurrences) est dans le back-office, onglet « Erreurs ».',
    ].filter(Boolean),
  });
}

/**
 * Enregistre une erreur. Ne lève jamais. `error` : une Error (ou tout ce qui a `message`/`stack`).
 * `location` : route, nom de tâche ou page. Renvoie l'id de la ligne, ou null si rien n'a été écrit.
 */
async function recordError({ kind, error, location = null, tenantId = null, userId = null }) {
  try {
    if (!KINDS.has(kind)) return null;
    const message = clip(error?.message || error || 'Erreur sans message', 500);
    const stack = error?.stack ? clip(error.stack, 8000) : null;
    const where = location ? clip(location, 255) : null;
    const fingerprint = fingerprintOf({ kind, message, location: where, stack });

    const [[existing]] = await pool.query(
      'SELECT id, resolved_at, last_alerted_at FROM platform_error_events WHERE fingerprint = :fingerprint LIMIT 1',
      { fingerprint },
    );

    if (!existing && kind === 'frontend') {
      const [[{ n }]] = await pool.query(
        "SELECT COUNT(*) AS n FROM platform_error_events WHERE kind = 'frontend' AND resolved_at IS NULL",
      );
      if (n >= MAX_OPEN_FRONTEND_EVENTS) return null;
    }

    // `ON DUPLICATE KEY` : deux occurrences simultanées de la même erreur nouvelle ne se marchent pas dessus.
    const [result] = await pool.query(
      `INSERT INTO platform_error_events (fingerprint, kind, message, stack, location, tenant_id, user_id)
       VALUES (:fingerprint, :kind, :message, :stack, :where, :tenantId, :userId)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         occurrences = occurrences + 1,
         last_seen_at = NOW(),
         resolved_at = NULL,
         stack = COALESCE(VALUES(stack), stack),
         tenant_id = COALESCE(VALUES(tenant_id), tenant_id),
         user_id = COALESCE(VALUES(user_id), user_id)`,
      { fingerprint, kind, message, stack, where, tenantId, userId },
    );
    const id = result.insertId;

    const reopened = !!existing?.resolved_at;
    const alertedRecently =
      existing?.last_alerted_at && Date.now() - new Date(existing.last_alerted_at).getTime() < REALERT_AFTER_HOURS * 3600 * 1000;
    if (!existing || (reopened && !alertedRecently)) {
      await pool.query('UPDATE platform_error_events SET last_alerted_at = NOW() WHERE id = :id', { id });
      alertAdmin({ kind, message, location: where, tenantId, reopened }).catch((err) =>
        logger.warn('Suivi des erreurs : e-mail d’alerte impossible', { message: err.message }),
      );
    }
    return id;
  } catch (err) {
    logger.warn('Suivi des erreurs : enregistrement impossible', { message: err.message });
    return null;
  }
}

/** Erreur 500 d'une requête HTTP — appelé par le gestionnaire d'erreurs terminal. */
function recordRequestError(err, req) {
  return recordError({
    kind: 'api',
    error: err,
    location: `${req.method} ${normalizePath(req.originalUrl || req.url)}`,
    tenantId: req.user?.tenantId ?? null,
    userId: req.user?.id ?? null,
  });
}

module.exports = { recordError, recordRequestError, normalizePath, fingerprintOf };
