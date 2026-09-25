'use strict';

// Vérification publique d'authenticité (étape 29) : un tiers recevant une
// quittance/attestation/relevé (banque, autre bailleur...) peut confirmer
// que le document est réellement émis par Lyko System, sans compte ni accès
// à l'espace connecté. Ne renvoie JAMAIS de montant ni de donnée sur le
// locataire/propriétaire concerné — seulement de quoi confirmer
// l'authenticité (type de document, date d'émission, entreprise émettrice).

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { ApiError } = require('../middleware/error');
const { findByVerificationCode } = require('../services/documentIssuance');

const router = Router();

// ~60 bits d'aléa rendent déjà l'énumération impraticable (voir
// utils/tokens.js) — ce quota est une protection en profondeur, pas la
// défense principale, même logique que `portalLimiter`.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});
router.use(verifyLimiter);

const DOCUMENT_TYPE_LABELS = {
  quittance: 'Quittance de loyer',
  attestation: 'Attestation de location',
  releve_proprietaire: 'Relevé propriétaire',
  carnet_charges: 'Carnet des charges SONEB/SBEE',
};

// GET /api/verify/:code
router.get('/:code', async (req, res, next) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    return next(new ApiError(400, 'Format de code invalide.'));
  }
  try {
    const found = await findByVerificationCode(code);
    if (!found) {
      return res.json({ valid: false });
    }
    res.json({
      valid: true,
      documentType: found.document_type,
      documentTypeLabel: DOCUMENT_TYPE_LABELS[found.document_type] ?? found.document_type,
      companyName: found.company_name,
      issuedAt: found.created_at,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
