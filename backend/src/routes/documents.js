'use strict';

// Consultation/réinitialisation du compteur de téléchargements d'un document
// remis à un locataire/propriétaire (étape 29) — depuis l'espace employé,
// jamais depuis un portail. La consultation (nombre de téléchargements déjà
// utilisés) est ouverte à tout employé authentifié du même tenant (une
// simple donnée de suivi, pas sensible) ; la réinitialisation est réservée
// au DG (décision explicite de l'utilisateur).

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getIssuanceStatus, resetIssuance } = require('../services/documentIssuance');
const logger = require('../utils/logger');

const router = Router();
router.use(requireAuth);

const DOCUMENT_TYPES = ['quittance', 'attestation', 'releve_proprietaire'];

/**
 * Vérifie que `referenceId` désigne bien une ligne de CE tenant pour ce type
 * de document — sans ça, un employé pourrait consulter/réinitialiser le
 * compteur d'un document d'une autre entreprise en devinant un id.
 */
async function assertReferenceBelongsToTenant(tenantId, documentType, referenceId) {
  let rows;
  if (documentType === 'quittance') {
    [rows] = await pool.query(
      `SELECT rp.id FROM rent_payments rp JOIN leases l ON l.id = rp.lease_id
       WHERE rp.id = :referenceId AND l.tenant_id = :tenantId AND rp.deleted_at IS NULL LIMIT 1`,
      { referenceId, tenantId },
    );
  } else if (documentType === 'attestation') {
    [rows] = await pool.query('SELECT id FROM leases WHERE id = :referenceId AND tenant_id = :tenantId LIMIT 1', {
      referenceId,
      tenantId,
    });
  } else {
    [rows] = await pool.query('SELECT id FROM owners WHERE id = :referenceId AND tenant_id = :tenantId LIMIT 1', {
      referenceId,
      tenantId,
    });
  }
  if (!rows[0]) throw new ApiError(404, 'Document introuvable');
}

// GET /api/documents/:documentType/:referenceId/status
router.get('/:documentType/:referenceId/status', async (req, res, next) => {
  const { documentType } = req.params;
  const referenceId = Number(req.params.referenceId);
  if (!DOCUMENT_TYPES.includes(documentType)) return next(new ApiError(400, 'Type de document invalide'));
  if (!Number.isInteger(referenceId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    await assertReferenceBelongsToTenant(req.user.tenantId, documentType, referenceId);
    const status = await getIssuanceStatus(req.user.tenantId, documentType, referenceId);
    res.json({
      downloadCount: status ? status.download_count : 0,
      maxDownloads: status ? status.max_downloads : 5,
      lastDownloadedAt: status ? status.last_downloaded_at : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/documents/:documentType/:referenceId/reset — DG uniquement.
router.post('/:documentType/:referenceId/reset', requireRole('dg'), async (req, res, next) => {
  const { documentType } = req.params;
  const referenceId = Number(req.params.referenceId);
  if (!DOCUMENT_TYPES.includes(documentType)) return next(new ApiError(400, 'Type de document invalide'));
  if (!Number.isInteger(referenceId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    await assertReferenceBelongsToTenant(req.user.tenantId, documentType, referenceId);
    await resetIssuance(req.user.tenantId, documentType, referenceId, req.user.id);
    logger.info('Compteur de téléchargement réinitialisé', {
      tenantId: req.user.tenantId,
      documentType,
      referenceId,
      by: req.user.id,
    });
    const status = await getIssuanceStatus(req.user.tenantId, documentType, referenceId);
    res.json({
      downloadCount: status ? status.download_count : 0,
      maxDownloads: status ? status.max_downloads : 5,
      lastDownloadedAt: status ? status.last_downloaded_at : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
