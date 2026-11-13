'use strict';

/**
 * Import en masse depuis Excel (demande utilisateur, 2026-11-13) — voir services/bulkImport.js.
 * Réservé au DG : un import crée d'un coup propriétaires, biens, logements, locataires et baux.
 *
 *   GET  /api/import/template  → le modèle Excel à remplir
 *   POST /api/import/preview   → vérifie le fichier et montre ce qui serait créé (n'écrit rien)
 *   POST /api/import/confirm   → importe réellement (tout ou rien)
 *
 * Sans état côté serveur : le navigateur renvoie le même fichier à la confirmation, et il est
 * revérifié entièrement — un aperçu ne « réserve » jamais rien.
 */

const { Router } = require('express');
const multer = require('multer');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole } = require('../middleware/auth');
const { buildTemplateBuffer, runImport } = require('../services/bulkImport');

const router = Router();
router.use(requireAuth, requireRole('dg'));

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Certains navigateurs/téléphones envoient un type générique : l'extension fait alors foi, et le
    // contenu est de toute façon vérifié à la lecture du classeur.
    if (file.mimetype !== XLSX_MIME && !/\.xlsx$/i.test(file.originalname || '')) {
      return cb(new ApiError(400, 'Format non accepté : envoyez un fichier Excel (.xlsx), 5 Mo maximum.'));
    }
    cb(null, true);
  },
});

router.get('/template', async (_req, res, next) => {
  try {
    const buffer = await buildTemplateBuffer();
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition': 'attachment; filename="modele-import-africa-immo.xlsx"',
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  } catch (err) { next(err); }
});

function handler(commit) {
  return async (req, res, next) => {
    try {
      if (!req.file) throw new ApiError(400, 'Aucun fichier reçu.');
      const result = await runImport(req.user.tenantId, req.user.id, req.file.buffer, { commit });
      // Confirmation refusée = 422 (le fichier doit être corrigé) ; l'aperçu répond toujours 200,
      // erreurs comprises : c'est son rôle de les montrer.
      res.status(commit && !result.ok ? 422 : 200).json(result);
    } catch (err) { next(err); }
  };
}
router.post('/preview', upload.single('file'), handler(false));
router.post('/confirm', upload.single('file'), handler(true));

module.exports = router;
