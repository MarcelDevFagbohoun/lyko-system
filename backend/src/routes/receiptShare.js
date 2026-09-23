'use strict';

// Lien de partage direct d'une quittance (envoyée par WhatsApp juste après un
// paiement) — public, sans compte ni portail : le token dans l'URL est le
// seul secret, comme le portail locataire ou un lien de paiement. Scope
// actuel : quittance uniquement (demande explicite de l'utilisateur) —
// l'attestation/le relevé propriétaire restent réservés au portail pour
// l'instant.

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { findByShareToken, registerDownload } = require('../services/documentIssuance');
const { streamReceiptPdf } = require('../services/pdf');
const { UNIT_DESIGNATIONS } = require('../constants/properties');

const router = Router();

// Même principe que les autres routes publiques (portail, vérification,
// paiement) : le token (192 bits d'aléa) rend déjà le brute-force
// impraticable, ce quota est une protection en profondeur.
const shareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});
router.use(shareLimiter);

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
function unitDesignationLabel(row) {
  return row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
}

// GET /api/recu/:token — la quittance elle-même (PDF), en lecture seule.
router.get('/:token', async (req, res, next) => {
  try {
    const issuance = await findByShareToken(req.params.token);
    // 404 générique, jamais de distinction lien inconnu / mauvais type de
    // document / déjà épuisé — même principe de non-énumération que le reste
    // de l'application.
    if (!issuance || issuance.document_type !== 'quittance') {
      throw new ApiError(404, 'Lien invalide ou expiré');
    }

    const paymentId = issuance.reference_id;
    const [paymentRows] = await pool.query(
      'SELECT * FROM rent_payments WHERE id = :id AND tenant_id = :tenantId AND deleted_at IS NULL LIMIT 1',
      { id: paymentId, tenantId: issuance.tenant_id },
    );
    if (!paymentRows[0]) throw new ApiError(404, 'Lien invalide ou expiré');
    const payment = paymentRows[0];

    const [receiptRows] = await pool.query('SELECT * FROM receipts WHERE payment_id = :id LIMIT 1', {
      id: paymentId,
    });
    if (!receiptRows[0]) throw new ApiError(404, 'Lien invalide ou expiré');

    const [leaseRows] = await pool.query(
      `SELECT l.*, u.designation, u.designation_custom, p.address AS property_address
       FROM leases l
       JOIN property_units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       WHERE l.id = :id LIMIT 1`,
      { id: payment.lease_id },
    );
    if (!leaseRows[0]) throw new ApiError(404, 'Lien invalide ou expiré');
    const lease = leaseRows[0];

    const [renterRows] = await pool.query('SELECT * FROM renters WHERE id = :id LIMIT 1', { id: lease.renter_id });
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', {
      id: issuance.tenant_id,
    });
    // Cachet/signature de l'employé qui a réellement encaissé — `recorded_by`
    // est NULL pour un paiement confirmé par KKiaPay, la requête ne renvoie
    // alors rien et `streamReceiptPdf` retombe sur le cachet de l'entreprise.
    const [issuerRows] = await pool.query('SELECT * FROM users WHERE id = :id LIMIT 1', {
      id: payment.recorded_by,
    });

    await registerDownload(issuance);

    const label = unitDesignationLabel(lease);
    streamReceiptPdf(res, {
      tenant: tenantRows[0],
      renter: renterRows[0],
      property: { label, address: lease.property_address },
      lease,
      payment,
      receipt: receiptRows[0],
      issuer: issuerRows[0] || null,
      verificationCode: issuance.verification_code,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
