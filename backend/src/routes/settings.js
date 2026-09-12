'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole } = require('../middleware/auth');
const { updateSettingsSchema } = require('../validators/settings');
const { assertUploadType, randomFileName } = require('../utils/uploads');
const { DEFAULT_CONTRACT_TEMPLATE, CONTRACT_PLACEHOLDERS } = require('../constants/contract');
const logger = require('../utils/logger');

const router = Router();
// Réglages de l'entreprise : réservés au DG (au même titre que la gestion des employés).
router.use(requireAuth, requireRole('dg'));

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new ApiError(400, 'Formats acceptés : PNG, JPEG, WEBP (2 Mo max)'));
    }
    cb(null, true);
  },
});

function toPublicSettings(tenant) {
  return {
    contractTemplate: tenant.contract_template,
    defaultContractTemplate: DEFAULT_CONTRACT_TEMPLATE,
    placeholders: CONTRACT_PLACEHOLDERS,
    stampUrl: tenant.stamp_path ? `/uploads/${tenant.stamp_path}` : null,
    signatureUrl: tenant.signature_path ? `/uploads/${tenant.signature_path}` : null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', {
      id: req.user.tenantId,
    });
    if (!rows[0]) throw new ApiError(404, 'Entreprise introuvable');
    res.json({ settings: toPublicSettings(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/',
  upload.fields([
    { name: 'stamp', maxCount: 1 },
    { name: 'signature', maxCount: 1 },
  ]),
  async (req, res, next) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
    }
    const data = parsed.data;

    try {
      const fields = [];
      const params = { id: req.user.tenantId };

      if (data.contractTemplate !== undefined) {
        fields.push('contract_template = :contractTemplate');
        params.contractTemplate = data.contractTemplate;
      }

      const stampFile = req.files?.stamp?.[0];
      const signatureFile = req.files?.signature?.[0];

      // Chemins actuels : pour supprimer l'ancien fichier après remplacement
      // (les noms sont désormais aléatoires — étape 12 — donc non réutilisés).
      const oldPaths = [];
      if (stampFile || signatureFile) {
        const dir = path.join(UPLOADS_ROOT, `tenants/${req.user.tenantId}`);
        await fs.mkdir(dir, { recursive: true });
        const [[current]] = await pool.query(
          'SELECT stamp_path, signature_path FROM tenants WHERE id = :id LIMIT 1',
          { id: req.user.tenantId },
        );
        if (stampFile && current?.stamp_path) oldPaths.push(current.stamp_path);
        if (signatureFile && current?.signature_path) oldPaths.push(current.signature_path);
      }
      if (stampFile) {
        const ext = assertUploadType(stampFile, { label: 'Cachet' });
        const rel = `tenants/${req.user.tenantId}/${randomFileName('stamp', ext)}`;
        await fs.writeFile(path.join(UPLOADS_ROOT, rel), stampFile.buffer);
        fields.push('stamp_path = :stampPath');
        params.stampPath = rel;
      }
      if (signatureFile) {
        const ext = assertUploadType(signatureFile, { label: 'Signature' });
        const rel = `tenants/${req.user.tenantId}/${randomFileName('signature', ext)}`;
        await fs.writeFile(path.join(UPLOADS_ROOT, rel), signatureFile.buffer);
        fields.push('signature_path = :signaturePath');
        params.signaturePath = rel;
      }

      if (fields.length > 0) {
        await pool.query(`UPDATE tenants SET ${fields.join(', ')} WHERE id = :id`, params);
      }

      // Nettoyage des anciens fichiers remplacés (best-effort, hors chemin critique).
      await Promise.all(
        oldPaths.map((rel) => fs.unlink(path.join(UPLOADS_ROOT, rel)).catch(() => {})),
      );

      const [rows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', {
        id: req.user.tenantId,
      });
      logger.info('Paramètres entreprise mis à jour', { tenantId: req.user.tenantId, by: req.user.id });
      res.json({ settings: toPublicSettings(rows[0]) });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
