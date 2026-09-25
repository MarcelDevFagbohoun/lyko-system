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
const { ROLE_TITLE_PRESETS, resolveRoleLabels } = require('../constants/roles');
const { encryptSecret } = require('../utils/encryption');
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
    // Nom des 3 postes chez cette entreprise (Réglages) — menu déroulant
    // fermé, voir constants/roles.js. Affiché partout, y compris à la
    // connexion employé (voir GET /api/auth/role-titles, public).
    roleTitles: resolveRoleLabels(tenant),
    roleTitlePresets: ROLE_TITLE_PRESETS,
    // Paiement en ligne (KKiaPay) : la clé publique est sans risque (faite
    // pour être embarquée côté client), mais les clés privée/secrète ne
    // sont JAMAIS renvoyées, même à ce DG — `kkiapayConfigured` indique
    // seulement si elles sont déjà enregistrées, pour affichage (ex. « clé
    // déjà configurée, laissez vide pour la conserver »).
    kkiapayEnabled: !!tenant.kkiapay_enabled,
    kkiapaySandbox: !!tenant.kkiapay_sandbox,
    kkiapayPublicKey: tenant.kkiapay_public_key,
    kkiapayConfigured: !!(tenant.kkiapay_private_key_enc && tenant.kkiapay_secret_key_enc),
    // Convention de paiement du loyer par défaut (avance/terme échu) —
    // pré-remplit chaque nouveau bail, voir constants/rentTiming.js.
    defaultRentTiming: tenant.default_rent_timing,
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
      if (data.dgTitle !== undefined) {
        fields.push('dg_title = :dgTitle');
        params.dgTitle = data.dgTitle;
      }
      if (data.comptableTitle !== undefined) {
        fields.push('comptable_title = :comptableTitle');
        params.comptableTitle = data.comptableTitle;
      }
      if (data.agentTitle !== undefined) {
        fields.push('agent_title = :agentTitle');
        params.agentTitle = data.agentTitle;
      }
      if (data.kkiapaySandbox !== undefined) {
        fields.push('kkiapay_sandbox = :kkiapaySandbox');
        params.kkiapaySandbox = data.kkiapaySandbox;
      }
      if (data.kkiapayPublicKey !== undefined) {
        fields.push('kkiapay_public_key = :kkiapayPublicKey');
        params.kkiapayPublicKey = data.kkiapayPublicKey;
      }
      // Écriture seule : un champ vide/absent laisse la clé déjà enregistrée
      // intacte (sinon rouvrir Réglages sans rien taper l'effacerait à
      // chaque sauvegarde, puisqu'elle n'est jamais renvoyée en clair).
      if (data.kkiapayPrivateKey) {
        fields.push('kkiapay_private_key_enc = :kkiapayPrivateKeyEnc');
        params.kkiapayPrivateKeyEnc = encryptSecret(data.kkiapayPrivateKey);
      }
      if (data.kkiapaySecretKey) {
        fields.push('kkiapay_secret_key_enc = :kkiapaySecretKeyEnc');
        params.kkiapaySecretKeyEnc = encryptSecret(data.kkiapaySecretKey);
      }
      if (data.kkiapayEnabled !== undefined) {
        if (data.kkiapayEnabled) {
          // Activer n'a de sens que si les 3 clés existent (déjà en base ou
          // fournies dans cette même requête) — sinon le bouton « Payer
          // maintenant » apparaîtrait côté locataire sans rien derrière.
          const [[current]] = await pool.query(
            'SELECT kkiapay_public_key, kkiapay_private_key_enc, kkiapay_secret_key_enc FROM tenants WHERE id = :id LIMIT 1',
            { id: req.user.tenantId },
          );
          const hasPublicKey = data.kkiapayPublicKey ?? current?.kkiapay_public_key;
          const hasPrivateKey = data.kkiapayPrivateKey || current?.kkiapay_private_key_enc;
          const hasSecretKey = data.kkiapaySecretKey || current?.kkiapay_secret_key_enc;
          if (!hasPublicKey || !hasPrivateKey || !hasSecretKey) {
            throw new ApiError(400, 'Renseignez les 3 clés KKiaPay (publique, privée, secrète) avant d\'activer le paiement en ligne.');
          }
        }
        fields.push('kkiapay_enabled = :kkiapayEnabled');
        params.kkiapayEnabled = data.kkiapayEnabled;
      }

      if (data.defaultRentTiming !== undefined) {
        fields.push('default_rent_timing = :defaultRentTiming');
        params.defaultRentTiming = data.defaultRentTiming;
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
