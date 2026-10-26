'use strict';

// Portail locataire (lecture de ses paiements/quittances/contrat +
// signalement d'incident) — sans compte, sans mot de passe : l'accès se fait
// par un lien secret unique (`requirePortalToken`, voir middleware/portalAuth.js).
// Jamais de `requireAuth` employé ici — ce routeur n'est monté sous AUCUNE
// permission du catalogue existant, il vit à côté, pour un tiers externe.

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { ApiError } = require('../middleware/error');
const { requirePortalToken } = require('../middleware/portalAuth');
const { portalComplaintSchema } = require('../validators/portal');
const { UNIT_DESIGNATIONS } = require('../constants/properties');
const { computeArrears, buildRentStrip, paymentPeriodKey } = require('../services/rentTracking');
const { streamReceiptPdf, streamChargeReceiptPdf, streamLeaseContractPdf, streamMoveInPdf, streamMoveOutPdf } = require('../services/pdf');
const { loadContractRow, toPublicContract } = require('../services/leaseContract');
const {
  normalizeStoredItems,
  toPublicInspectionReport,
  toPublicMoveOutReport,
} = require('../services/inspection');
const { getOrCreateIssuance, registerDownload } = require('../services/documentIssuance');
const { startCheckout } = require('../services/onlinePayments');
const portal = require('../services/portal');
const logger = require('../utils/logger');
const { isoDate } = require('../utils/dates');

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

// GET /api/portal/:token — tableau de bord : identité, bail actif, retard,
// paiements + quittances de ce bail.
router.get('/:token', async (req, res, next) => {
  try {
    const { id: renterId, tenantId, firstName, lastName } = req.portalRenter;
    const { tenantRow, activeLease, payRows, chargeRows, cpRows, hasSignedContract, lastLease } =
      await portal.getDashboardData(tenantId, renterId);

    let payments = [];
    let arrears = null;
    let rentStrip = null;
    let unpaidCharges = [];
    let chargePayments = [];
    if (activeLease) {
      // Refonte de la clôture (étape 2/5) : rythme DU BAIL (pas du tenant), dérivé de ses propres
      // colonnes — voir le même raisonnement dans `routes/leases.js` (`recordRentPayment`). Les clés
      // de période renvoyées (`coversMonth`, frise) sont 'AAAA-MM-JJ' pour un bail non-calendaire ;
      // le portail les libelle en plage de dates (étape 2c, `monthLabelFr` côté frontend).
      const isCalendaireLease = activeLease.rent_due_day != null;
      const portalRhythm = { mode: isCalendaireLease ? 'calendaire' : 'jour_fixe' };
      payments = payRows.map((p) => ({
        id: p.id,
        coversMonth: paymentPeriodKey(p),
        amount: Number(p.amount),
        paymentMethod: p.payment_method,
        paidAt: isoDate(p.paid_at),
        receipt: p.receipt_id ? { id: p.receipt_id, number: p.receipt_number } : null,
      }));
      const startDate =
        activeLease.start_date instanceof Date ? activeLease.start_date.toISOString().slice(0, 10) : activeLease.start_date;
      const mappedPayRows = payRows.map((p) => ({
        coversMonth: paymentPeriodKey(p),
        amount: Number(p.amount),
      }));
      arrears = computeArrears({
        startDate,
        createdAt: activeLease.created_at,
        upToDateAtOnboarding: !!activeLease.up_to_date_at_onboarding,
        rentDueDay: activeLease.rent_due_day,
        rentDueOffsetDays: activeLease.rent_due_offset_days,
        rentTiming: activeLease.rent_timing,
        monthlyRent: activeLease.monthly_rent,
        entryProration: activeLease.entry_proration,
        payments: mappedPayRows,
        rhythm: portalRhythm,
      });
      // Frise des 12 mois : ses propres paiements, mois par mois.
      rentStrip = buildRentStrip({
        startDate,
        createdAt: activeLease.created_at,
        upToDateAtOnboarding: !!activeLease.up_to_date_at_onboarding,
        rentDueDay: activeLease.rent_due_day,
        rentDueOffsetDays: activeLease.rent_due_offset_days,
        rentTiming: activeLease.rent_timing,
        monthlyRent: activeLease.monthly_rent,
        entryProration: activeLease.entry_proration,
        payments: mappedPayRows,
        rhythm: portalRhythm,
      });


      unpaidCharges = chargeRows.map((c) => ({
        id: c.id,
        utilityType: c.utility_type,
        periodStart: isoDate(c.period_start),
        periodEnd: isoDate(c.period_end),
        amount: Number(c.amount),
        remaining: Number(c.amount) - Number(c.paid_total),
        status: c.status,
      }));

      chargePayments = cpRows.map((r) => ({
        id: r.id,
        utilityType: r.utility_type,
        periodStart: isoDate(r.period_start),
        periodEnd: isoDate(r.period_end),
        amount: Number(r.amount),
        paidAt: isoDate(r.paid_at),
      }));
    }

    res.json({
      tenant: {
        // Sert uniquement à construire la référence interne posée dans le
        // widget de paiement (`t<tenantId>:rent:<leaseId>`) — pas sensible,
        // du même ordre que les autres identifiants numériques déjà exposés
        // (bail, paiement...).
        id: tenantId,
        companyName: tenantRow?.company_name ?? null,
        logoUrl: tenantRow?.logo_path ? `/uploads/${tenantRow.logo_path}` : null,
        onlinePaymentEnabled: !!tenantRow?.fedapay_collect_enabled,
      },
      renter: { firstName, lastName },
      activeLease: activeLease
        ? {
            id: activeLease.id,
            unitCode: activeLease.unit_code,
            designationLabel: unitDesignationLabel(activeLease),
            monthlyRent: Number(activeLease.monthly_rent),
            startDate: isoDate(activeLease.start_date),
            hasSignedContract,
          }
        : null,
      arrears,
      rentStrip,
      payments,
      unpaidCharges,
      chargePayments,
      lastLease,
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
    const { lease, payment, receipt, renter, tenant, issuer } = await portal.getRentReceiptData(tenantId, renterId, paymentId);

    // Limite de 5 téléchargements + code de vérification (étape 29) — la
    // même quittance (ce paiement précis), pas le lien du portail : le
    // régénérer ne remet jamais ce compteur à zéro.
    const issuance = await getOrCreateIssuance(tenantId, 'quittance', paymentId);
    await registerDownload(issuance);

    // Même résolution du libellé de l'unité que /contract.pdf ci-dessous
    // (`lease` ne porte que `designation`/`designation_custom` bruts, pas de
    // libellé déjà résolu — sans ça, la mention « au titre du loyer de » de
    // la quittance affichait « undefined »).
    const label = unitDesignationLabel(lease);
    streamReceiptPdf(res, {
      tenant,
      renter,
      property: { label, address: lease.property_address },
      lease,
      payment,
      receipt,
      issuer,
      verificationCode: issuance.verification_code,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/:token/charge-payments/:paymentId/receipt.pdf — reçu de SON règlement de charges.
router.get('/:token/charge-payments/:paymentId/receipt.pdf', async (req, res, next) => {
  const paymentId = Number(req.params.paymentId);
  if (!Number.isInteger(paymentId) || paymentId <= 0) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const { id: renterId, tenantId } = req.portalRenter;
    const { tenant, renter, row } = await portal.getChargeReceiptData(tenantId, renterId, paymentId);
    streamChargeReceiptPdf(res, { tenant, renter, charge: row, payment: row });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/:token/contract.pdf — son contrat de bail, une fois signé par les deux parties
// (jamais un brouillon non signé depuis le portail public).
router.get('/:token/contract.pdf', async (req, res, next) => {
  try {
    const { id: renterId, tenantId } = req.portalRenter;
    const { lease, contractRow, tenant, issuer } = await portal.getContractData(tenantId, renterId, loadContractRow);

    // Un contrat par BAIL (pas par génération) — même principe que l'ancienne attestation.
    const issuance = await getOrCreateIssuance(tenantId, 'contrat', lease.id);
    await registerDownload(issuance);

    streamLeaseContractPdf(res, {
      tenant,
      // `snapshot` est une colonne JSON — déjà un objet JS natif (voir la même note dans leases.js).
      data: contractRow.snapshot,
      contract: toPublicContract(contractRow),
      issuer,
      leaseId: lease.id,
      verificationCode: issuance.verification_code,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/:token/move-in-report.pdf — son état des lieux d'entrée,
// une fois signé (étape 48 : jusqu'ici invisible du portail — le locataire
// signait ce document sans jamais pouvoir le revoir lui-même).
router.get('/:token/move-in-report.pdf', async (req, res, next) => {
  try {
    const { id: renterId, tenantId } = req.portalRenter;
    const { lease, row, renter, tenant } = await portal.getMoveInData(tenantId, renterId);

    const issuance = await getOrCreateIssuance(tenantId, 'etat_lieux_entree', lease.id);
    await registerDownload(issuance);

    streamMoveInPdf(res, {
      tenant,
      renter,
      property: lease,
      lease,
      report: toPublicInspectionReport(row),
      verificationCode: issuance.verification_code,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/:token/move-out-report.pdf — son PV de sortie, une fois
// signé — accessible même après la fin du bail (voir `loadLastPortalLease`).
router.get('/:token/move-out-report.pdf', async (req, res, next) => {
  try {
    const { id: renterId, tenantId } = req.portalRenter;
    const { lease, row, renter, tenant, moveInRow } = await portal.getMoveOutData(tenantId, renterId);
    const moveInZones = moveInRow ? normalizeStoredItems(moveInRow.items) : [];

    const issuance = await getOrCreateIssuance(tenantId, 'etat_lieux_sortie', lease.id);
    await registerDownload(issuance);

    streamMoveOutPdf(res, {
      tenant,
      renter,
      property: lease,
      lease,
      report: toPublicMoveOutReport(row),
      moveInZones,
      additionalDeposits: [],
      verificationCode: issuance.verification_code,
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

  try {
    const { id: renterId, tenantId } = req.portalRenter;
    const { complaintId, code, leaseId } = await portal.createPortalComplaint(tenantId, renterId, parsed.data);

    logger.info('Plainte signalée depuis le portail locataire', {
      tenantId,
      renterId,
      leaseId,
      complaintId,
      code,
    });
    res.status(201).json({ complaintId, code });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/:token/rent/checkout { amount } — ouvre une page de paiement FedaPay pour SON loyer.
router.post('/:token/rent/checkout', async (req, res, next) => {
  try {
    const amount = Number(req.body?.amount);
    const { id: renterId, tenantId } = req.portalRenter;
    // Borne de bon sens : jamais plus d'un an de loyer en une fois (vérifiée par le service).
    const { tenant, renter, leaseId } = await portal.prepareRentCheckout(tenantId, renterId, amount);
    res.json(await startCheckout({
      tenant, kind: 'rent', leaseId, amount,
      customer: { name: `${renter.first_name} ${renter.last_name}`, email: renter.email },
    }));
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/:token/charges/:chargeId/checkout — le montant est le RESTE DÛ calculé côté serveur.
router.post('/:token/charges/:chargeId/checkout', async (req, res, next) => {
  const chargeId = Number(req.params.chargeId);
  if (!Number.isInteger(chargeId) || chargeId <= 0) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const { id: renterId, tenantId } = req.portalRenter;
    const { tenant, renter, remaining } = await portal.prepareChargeCheckout(tenantId, renterId, chargeId);
    res.json(await startCheckout({
      tenant, kind: 'charge', chargeId, amount: remaining,
      customer: { name: `${renter.first_name} ${renter.last_name}`, email: renter.email },
    }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
