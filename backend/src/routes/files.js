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
 * de cette session (`tenants/<tenantId>/…`) — gros progrès sur l'état
 * antérieur (accès public à quiconque, tout tenant confondu). Elle ne
 * revérifie PAS le périmètre agent par type d'entité (ex. un agent restreint
 * à certains Biens pourrait techniquement charger la photo d'un Bien hors de
 * son périmètre s'il connaît son URL) — seule la frontière tenant est
 * imposée, comme le fait la quasi-totalité des accès directs par id dans
 * cette application ; le cloisonnement agent porte sur les LISTES et fiches,
 * pas sur chaque fichier brut individuellement.
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

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

// Mêmes formats que `assertUploadType` (utils/uploads.js) — tout le reste
// n'a jamais été un type valide de fichier téléversé par cette application.
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'pdf']);

const router = Router();
router.use(requireAuth);

router.get('/*', (req, res, next) => {
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

  const ext = path.extname(normalized).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return next(new ApiError(404, 'Fichier introuvable'));
  }

  res.sendFile(normalized, { root: UPLOADS_ROOT }, (err) => {
    if (!err || res.headersSent) return;
    // Fichier absent (déjà supprimé, chemin obsolète…) : 404 générique,
    // jamais le chemin disque réel dans la réponse.
    next(new ApiError(404, 'Fichier introuvable'));
  });
});

module.exports = router;
