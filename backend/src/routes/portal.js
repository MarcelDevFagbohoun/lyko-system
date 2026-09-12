'use strict';

// Portail locataire (lecture de ses paiements/quittances/attestation +
// signalement d'incident) — sans compte, sans mot de passe : l'accès se fait
// par un lien secret unique (`requirePortalToken`, voir middleware/portalAuth.js).
// Jamais de `requireAuth` employé ici — ce routeur n'est monté sous AUCUNE
// permission du catalogue existant, il vit à côté, pour un tiers externe.

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requirePortalToken } = require('../middleware/portalAuth');
const { portalComplaintSchema } = require('../validators/portal');
const { UNIT_DESIGNATIONS } = require('../constants/properties');
const { computeArrears } = require('../services/rentTracking');
const { streamReceiptPdf, streamCertificatePdf } = require('../services/pdf');
const logger = require('../utils/logger');

const router = Router();

// Limiteur dédié : le token (256 bits) rend le brute-force pratiquement
// impossible, mais un quota par IP reste une protection en profondeur
// cohérente avec le reste de l'application (étape 12).
const portalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});
router.use(portalLimiter);
router.use('/:token', requirePortalToken);

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
function unitDesignationLabel(row) {
  return row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
}
function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * Charge le bail ACTIF du locataire authentifié par son token (ou lève 404).
 * Le portail ne donne accès qu'à la situation en cours, jamais à l'historique
 * de baux antérieurs (v1, volontairement minimal).
 */
async function loadActivePortalLease(tenantId, renterId) {
  const [rows] = await pool.query(
    `SELECT l.*, u.code AS unit_code, u.designation, u.designation_custom, p.address AS property_address
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.renter_id = :renterId AND l.tenant_id = :tenantId AND l.status = 'active'
     ORDER BY l.start_date DESC LIMIT 1`,
    { renterId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Aucun bail actif');
  return rows[0];
}

async function nextComplaintCode(tenantId) {
  const year = new Date().getFullYear();
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM complaints WHERE tenant_id = :tenantId AND code LIKE :prefix`,
    { tenantId, prefix: `INC-${year}-%` },
  );
  return `INC-${year}-${String(Number(rows[0].n) + 1).padStart(4, '0')}`;
}

// GET /api/portal/:token — tableau de bord : identité, bail actif, retard,
// paiements + quittances de ce bail.
router.get('/:token', async (req, res, next) => {
  try {
    const { id: renterId, tenantId, firstName, lastName } = req.portalRenter;

    const [tenantRows] = await pool.query(
      'SELECT company_name, logo_path FROM tenants WHERE id = :tenantId LIMIT 1',
      { tenantId },
    );

    const [leaseRows] = await pool.query(
      `SELECT l.*, u.code AS unit_code, u.designation, u.designation_custom
       FROM leases l JOIN property_units u ON u.id = l.unit_id
       WHERE l.renter_id = :renterId AND l.tenant_id = :tenantId AND l.status = 'active'
       ORDER BY l.start_date DESC LIMIT 1`,
      { renterId, tenantId },
    );
    const activeLease = leaseRows[0] || null;

    let payments = [];
    let arrears = null;
    if (activeLease) {
      const [payRows] = await pool.query(
        `SELECT rp.*, rc.id AS receipt_id, rc.receipt_number
         FROM rent_payments rp
         LEFT JOIN receipts rc ON rc.payment_id = rp.id
         WHERE rp.lease_id = :leaseId
         ORDER BY rp.paid_at DESC, rp.id DESC`,
        { leaseId: activeLease.id },
      );
      payments = payRows.map((p) => ({
        id: p.id,
        coversMonth: p.covers_month,
        amount: Number(p.amount),
        paymentMethod: p.payment_method,
        paidAt: isoDate(p.paid_at),
        receipt: p.receipt_id ? { id: p.receipt_id, number: p.receipt_number } : null,
      }));
      const startDate =
        activeLease.start_date instanceof Date ? activeLease.start_date.toISOString().slice(0, 10) : activeLease.start_date;
      arrears = computeArrears({
        startDate,
        rentDueDay: activeLease.rent_due_day,
        payments: payRows.map((p) => ({ coversMonth: p.covers_month })),
      });
    }

    res.json({
      tenant: {
        companyName: tenantRows[0]?.company_name ?? null,
        logoUrl: tenantRows[0]?.logo_path ? `/uploads/${tenantRows[0].logo_path}` : null,
      },
      renter: { firstName, lastName },
      activeLease: activeLease
        ? {
            id: activeLease.id,
            unitCode: activeLease.unit_code,
            designationLabel: unitDesignationLabel(activeLease),
            monthlyRent: Number(activeLease.monthly_rent),
            startDate: isoDate(activeLease.start_date),
          }
        : null,
      arrears,
      payments,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/:token/payments/:paymentId/receipt.pdf — sa propre quittance.
router.get('/:token/payments/:paymentId/receipt.pdf', async (req, res, next) => {
  const paymentId = Number(req.params.paymentId);
  if (!Number.isInteger(paymentId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const { id: renterId, tenantId } = req.portalRenter;
    const lease = await loadActivePortalLease(tenantId, renterId);

    const [paymentRows] = await pool.query(
      'SELECT * FROM rent_payments WHERE id = :paymentId AND lease_id = :leaseId LIMIT 1',
      { paymentId, leaseId: lease.id },
    );
    if (!paymentRows[0]) throw new ApiError(404, 'Paiement introuvable');

    const [receiptRows] = await pool.query('SELECT * FROM receipts WHERE payment_id = :paymentId LIMIT 1', {
      paymentId,
    });
    if (!receiptRows[0]) throw new ApiError(404, 'Quittance introuvable');

    const [renterRows] = await pool.query('SELECT * FROM renters WHERE id = :id LIMIT 1', { id: renterId });
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });

    streamReceiptPdf(res, {
      tenant: tenantRows[0],
      renter: renterRows[0],
      property: lease,
      lease,
      payment: paymentRows[0],
      receipt: receiptRows[0],
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/:token/certificate.pdf — son attestation de loyer (bail actif).
router.get('/:token/certificate.pdf', async (req, res, next) => {
  try {
    const { id: renterId, tenantId } = req.portalRenter;
    const lease = await loadActivePortalLease(tenantId, renterId);

    const [renterRows] = await pool.query('SELECT * FROM renters WHERE id = :id LIMIT 1', { id: renterId });
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });
    // Pas d'employé "signataire" particulier depuis le portail : le DG de
    // l'entreprise signe par défaut (toujours exactement un par tenant).
    const [dgRows] = await pool.query(
      "SELECT first_name, last_name FROM users WHERE tenant_id = :tenantId AND role = 'dg' LIMIT 1",
      { tenantId },
    );
    const issuer = dgRows[0] || { first_name: tenantRows[0]?.company_name ?? 'Le cabinet', last_name: '' };

    const label = unitDesignationLabel(lease);
    streamCertificatePdf(res, {
      tenant: tenantRows[0],
      renter: renterRows[0],
      property: { label, address: lease.property_address },
      lease,
      issuer,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/:token/complaints — signaler un incident sur son bail actif.
router.post('/:token/complaints', async (req, res, next) => {
  const parsed = portalComplaintSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const { id: renterId, tenantId } = req.portalRenter;
    const lease = await loadActivePortalLease(tenantId, renterId);
    const code = await nextComplaintCode(tenantId);

    const [result] = await pool.query(
      `INSERT INTO complaints
         (tenant_id, lease_id, code, category, title, description, priority, reported_at, created_by, reported_via_portal)
       VALUES (:tenantId, :leaseId, :code, :category, :title, :description, :priority, CURDATE(), NULL, 1)`,
      {
        tenantId,
        leaseId: lease.id,
        code,
        category: data.category,
        title: data.title,
        description: data.description,
        priority: data.priority,
      },
    );

    logger.info('Plainte signalée depuis le portail locataire', {
      tenantId,
      renterId,
      leaseId: lease.id,
      complaintId: result.insertId,
      code,
    });
    res.status(201).json({ complaintId: result.insertId, code });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
