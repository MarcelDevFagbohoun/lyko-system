'use strict';

// Portail propriétaire (étape 13, idée n°1) — même principe que le portail
// locataire (`routes/portal.js`) : lien secret, sans compte, sans mot de
// passe (`requireOwnerPortalToken`, voir middleware/portalAuth.js). Jamais de
// `requireAuth` employé ici — ce routeur vit à côté du catalogue de
// permissions existant, pour un tiers externe à l'entreprise.
//
// Donne au propriétaire de quoi vérifier lui-même sa recette et ses
// versements, sans appeler le cabinet : patrimoine géré, recette nette /
// commission / part propriétaire du mois (par Bien, réutilise le même
// calculateur que la fiche du Bien côté employé), historique des
// versements, et son relevé PDF déjà existant.

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireOwnerPortalToken } = require('../middleware/portalAuth');
const { UNIT_DESIGNATIONS, PROPERTY_TYPES } = require('../constants/properties');
const { getRecetteProprietaire } = require('../services/commission');
const { streamOwnerStatementPdf } = require('../services/pdf');
const { getOrCreateIssuance, registerDownload } = require('../services/documentIssuance');

const router = Router();

// Même quota que le portail locataire : le token (256 bits) rend le
// brute-force déjà impraticable, ce limiteur n'est qu'une profondeur de
// défense supplémentaire.
const portalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});
router.use(portalLimiter);
router.use('/:token', requireOwnerPortalToken);

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
const PROPERTY_TYPE_LABELS = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.key, t.label]));
function unitDesignationLabel(row) {
  return row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
}
function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}
function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
};

/** Patrimoine du propriétaire (Biens + unités + locataire en cours), même requête que la fiche employé. */
async function loadOwnerProperties(tenantId, ownerId) {
  const [rows] = await pool.query(
    `SELECT p.id, p.code, p.address, p.property_type,
            u.id AS unit_id, u.code AS unit_code, u.designation, u.designation_custom,
            u.status AS unit_status, u.monthly_rent,
            r.first_name AS renter_first_name, r.last_name AS renter_last_name
     FROM properties p
     LEFT JOIN property_units u ON u.property_id = p.id
     LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
     LEFT JOIN renters r ON r.id = l.renter_id
     WHERE p.owner_id = :ownerId AND p.tenant_id = :tenantId
     ORDER BY p.code, u.code`,
    { ownerId, tenantId },
  );

  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.id)) {
      byId.set(row.id, {
        id: row.id,
        code: row.code,
        address: row.address,
        type: row.property_type,
        typeLabel: PROPERTY_TYPE_LABELS[row.property_type] ?? row.property_type,
        units: [],
      });
    }
    if (row.unit_id) {
      byId.get(row.id).units.push({
        id: row.unit_id,
        code: row.unit_code,
        designationLabel: unitDesignationLabel(row),
        status: row.unit_status,
        monthlyRent: Number(row.monthly_rent),
        currentRenter: row.renter_first_name ? `${row.renter_first_name} ${row.renter_last_name}` : null,
      });
    }
  }
  return [...byId.values()];
}

// GET /api/owner-portal/:token?mois=AAAA-MM — tableau de bord : identité,
// patrimoine, recette nette/commission/part propriétaire du mois (par Bien
// et au total), historique des versements récents.
router.get('/:token', async (req, res, next) => {
  try {
    const { id: ownerId, tenantId, name } = req.portalOwner;
    const yearMonth = /^\d{4}-\d{2}$/.test(req.query.mois) ? req.query.mois : currentYearMonth();

    const [tenantRows] = await pool.query(
      'SELECT company_name, logo_path FROM tenants WHERE id = :tenantId LIMIT 1',
      { tenantId },
    );

    const properties = await loadOwnerProperties(tenantId, ownerId);

    const recetteByProperty = await Promise.all(
      properties.map((p) => getRecetteProprietaire(tenantId, p.id, yearMonth)),
    );
    const totals = recetteByProperty.reduce(
      (acc, r) => ({
        totalPayments: acc.totalPayments + r.totalPayments,
        totalExpenses: acc.totalExpenses + r.totalExpenses,
        recetteNette: acc.recetteNette + r.recetteNette,
        commissionCabinet: acc.commissionCabinet + r.commissionCabinet,
        partProprietaire: acc.partProprietaire + r.partProprietaire,
      }),
      { totalPayments: 0, totalExpenses: 0, recetteNette: 0, commissionCabinet: 0, partProprietaire: 0 },
    );

    const [payoutRows] = await pool.query(
      `SELECT op.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name, u.role AS recorded_by_role
       FROM owner_payouts op
       JOIN users u ON u.id = op.recorded_by
       WHERE op.owner_id = :ownerId
       ORDER BY op.paid_at DESC, op.id DESC
       LIMIT 12`,
      { ownerId },
    );

    res.json({
      tenant: {
        companyName: tenantRows[0]?.company_name ?? null,
        logoUrl: tenantRows[0]?.logo_path ? `/uploads/${tenantRows[0].logo_path}` : null,
      },
      owner: { name },
      properties,
      recette: {
        yearMonth,
        byProperty: properties.map((p, i) => ({
          propertyId: p.id,
          propertyCode: p.code,
          ...recetteByProperty[i],
        })),
        totals,
      },
      payouts: payoutRows.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        periodLabel: p.period_label,
        paidAt: isoDate(p.paid_at),
        paymentMethod: p.payment_method,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
        notes: p.notes,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/owner-portal/:token/statement.pdf — son relevé (patrimoine + historique des versements).
router.get('/:token/statement.pdf', async (req, res, next) => {
  try {
    const { id: ownerId, tenantId } = req.portalOwner;

    const [ownerRows] = await pool.query('SELECT * FROM owners WHERE id = :id LIMIT 1', { id: ownerId });
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });

    const [unitRows] = await pool.query(
      `SELECT p.code AS property_code, p.address,
              u.code AS unit_code, u.designation, u.designation_custom, u.status, u.monthly_rent,
              r.first_name AS renter_first_name, r.last_name AS renter_last_name
       FROM properties p
       JOIN property_units u ON u.property_id = p.id
       LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
       LEFT JOIN renters r ON r.id = l.renter_id
       WHERE p.owner_id = :ownerId
       ORDER BY p.code, u.code`,
      { ownerId },
    );

    const [payoutRows] = await pool.query(
      'SELECT * FROM owner_payouts WHERE owner_id = :ownerId ORDER BY paid_at DESC, id DESC LIMIT 24',
      { ownerId },
    );

    // Un seul relevé « courant » par propriétaire (pas par mois — ce PDF
    // couvre le patrimoine + les derniers versements, pas une période
    // précise) — limite de 5 téléchargements + code de vérification (étape 29).
    const issuance = await getOrCreateIssuance(tenantId, 'releve_proprietaire', ownerId);
    await registerDownload(issuance);

    streamOwnerStatementPdf(res, {
      tenant: tenantRows[0],
      owner: ownerRows[0],
      verificationCode: issuance.verification_code,
      units: unitRows.map((u) => ({
        propertyCode: u.property_code,
        address: u.address,
        unitCode: u.unit_code,
        designationLabel: unitDesignationLabel(u),
        status: u.status,
        monthlyRent: Number(u.monthly_rent),
        currentRenter: u.renter_first_name ? `${u.renter_first_name} ${u.renter_last_name}` : null,
      })),
      payouts: payoutRows.map((p) => ({
        amount: Number(p.amount),
        periodLabel: p.period_label,
        paidAt: p.paid_at,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
