'use strict';

/**
 * Bug corrigé (audit sécurité/logique, étape 49) : jusqu'ici, TOUS les
 * fichiers téléversés (photos de bien/plainte/état des lieux, justificatifs
 * de dépense, cachets/signatures, avatars) étaient servis par
 * `express.static('/uploads', …)` dans `app.js`, sans la moindre
 * authentification — seul un nom de fichier non devinable (suffixe
 * aléatoire, voir `utils/uploads.js`) protégeait ces documents. Quiconque
 * obtenait une URL (fuite de log, document partagé, capture d'écran…)
 * pouvait la consulter indéfiniment, sans session, depuis n'importe où.
 *
 * Cette route exige désormais une session valide ET borne l'accès au TENANT
 * de cette session (`tenants/<tenantId>/…`).
 *
 * Bug corrigé (audit sécurité, 2026-10-30) : un agent restreint à un
 * sous-ensemble du portefeuille (voir `services/scope.js`) pouvait, en
 * devinant/obtenant l'URL, charger la photo d'un Bien, d'un état des lieux
 * ou d'une plainte HORS de son périmètre — seule la frontière tenant était
 * vérifiée ici, jamais le périmètre agent par entité. Décision explicite de
 * l'utilisateur : « il ne peut rien faire sur un bien qui ne lui est pas
 * encore attribué » → `assertFileInAgentScope` ci-dessous résout le Bien
 * propriétaire du fichier (direct pour `properties/<id>/…`, via le bail pour
 * `inspections/<leaseId>/…` et `complaints/<complaintId>/…`) et compare son
 * `agent_id` au périmètre de la session, exactement comme le ferait la route
 * JSON équivalente (`loadProperty`/`assertLeaseInScope`). Les catégories
 * sans notion de portefeuille (dépenses/recettes — visibles via la
 * permission « comptabilite », pas par Bien ; avatars/cachet/signature —
 * communs à toute l'entreprise ; biens à VENDRE — module séparé, sans
 * notion d'agent) ne sont pas concernées et restent bornées au tenant.
 *
 * Restent volontairement PUBLICS (voir `app.js`, toujours servis par
 * `express.static`) : le logo d'entreprise (affiché sur les pages publiques
 * — portail locataire/propriétaire, page de paiement — avant toute
 * authentification) et les photos d'annonces marketplace (le site public
 * Quick Immo les affiche à des visiteurs anonymes, c'est tout le principe
 * d'une annonce immobilière publique).
 */

const path = require('path');
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/error');
const { pool } = require('../config/db');
const { resolvePropertyScope } = require('../services/scope');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

// Mêmes formats que `assertUploadType` (utils/uploads.js) — tout le reste
// n'a jamais été un type valide de fichier téléversé par cette application.
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'pdf']);

// Catégories de fichiers rattachées à un Bien précis (donc à un périmètre agent) et comment résoudre
// l'`agent_id` du Bien propriétaire à partir du 2e segment du chemin (`tenants/<id>/<catégorie>/<entityId>/…`).
const SCOPED_CATEGORIES = {
  // tenants/<tenantId>/properties/<propertyId>/…
  properties: async (tenantId, propertyId) => {
    const [[row]] = await pool.query('SELECT agent_id FROM properties WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
      id: propertyId,
      tenantId,
    });
    return row ? row.agent_id : undefined; // undefined = Bien introuvable dans ce tenant
  },
  // tenants/<tenantId>/inspections/<leaseId>/… (états des lieux, rattachés à un bail, pas à un Bien directement)
  inspections: async (tenantId, leaseId) => {
    const [[row]] = await pool.query(
      `SELECT p.agent_id FROM leases l
       JOIN property_units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       WHERE l.id = :id AND l.tenant_id = :tenantId LIMIT 1`,
      { id: leaseId, tenantId },
    );
    return row ? row.agent_id : undefined;
  },
  // tenants/<tenantId>/complaints/<complaintId>/… (plaintes, rattachées à un bail)
  complaints: async (tenantId, complaintId) => {
    const [[row]] = await pool.query(
      `SELECT p.agent_id FROM complaints c
       JOIN leases l ON l.id = c.lease_id
       JOIN property_units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       WHERE c.id = :id AND c.tenant_id = :tenantId LIMIT 1`,
      { id: complaintId, tenantId },
    );
    return row ? row.agent_id : undefined;
  },
};

/**
 * `true` si ce fichier peut être servi à cette session. `scopeAgentId` vient de `resolvePropertyScope` :
 * `null` = accès complet (DG, comptable, ou agent sans portefeuille restreint) ; sinon l'id de l'agent,
 * à comparer à l'`agent_id` du Bien propriétaire du fichier.
 */
async function assertFileInAgentScope(tenantId, scopeAgentId, normalized) {
  if (scopeAgentId == null) return true; // accès complet : rien à vérifier de plus
  const [, , category, entitySegment] = normalized.split('/');
  const resolver = SCOPED_CATEGORIES[category];
  if (!resolver) return true; // catégorie sans notion de portefeuille (dépenses, avatars, ventes…)
  const entityId = Number(entitySegment);
  if (!Number.isInteger(entityId)) return false;
  const agentId = await resolver(tenantId, entityId);
  return agentId !== undefined && Number(agentId) === Number(scopeAgentId);
}

const router = Router();
router.use(requireAuth);

router.get('/*', async (req, res, next) => {
  try {
    const rel = req.params[0];
    if (!rel) return next(new ApiError(404, 'Fichier introuvable'));

    // Défense en profondeur : rejette toute tentative de remontée de dossier
    // avant même de la faire dépendre de `send`/`sendFile` (qui la rejette
    // aussi via l'option `root` ci-dessous).
    const normalized = path.posix.normalize(rel);
    if (normalized.startsWith('..') || normalized.includes('/../')) {
      return next(new ApiError(404, 'Fichier introuvable'));
    }

    // Le cœur du correctif : borne stricte au tenant de LA SESSION EN COURS,
    // jamais un tenant demandé par le client.
    if (!normalized.startsWith(`tenants/${req.user.tenantId}/`)) {
      return next(new ApiError(404, 'Fichier introuvable'));
    }

    // Les pièces jointes de la Discussion ne sont lisibles que par les deux participants (routes/chat.js).
    if (normalized.includes('/chat/')) return next(new ApiError(404, 'Fichier introuvable'));

    const ext = path.extname(normalized).slice(1).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return next(new ApiError(404, 'Fichier introuvable'));
    }

    const scopeAgentId = await resolvePropertyScope(req.user);
    const allowed = await assertFileInAgentScope(req.user.tenantId, scopeAgentId, normalized);
    if (!allowed) return next(new ApiError(404, 'Fichier introuvable'));

    res.sendFile(normalized, { root: UPLOADS_ROOT }, (err) => {
      if (!err || res.headersSent) return;
      // Fichier absent (déjà supprimé, chemin obsolète…) : 404 générique,
      // jamais le chemin disque réel dans la réponse.
      next(new ApiError(404, 'Fichier introuvable'));
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
