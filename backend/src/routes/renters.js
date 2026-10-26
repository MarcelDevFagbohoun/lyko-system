'use strict';

const { Router } = require('express');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  createRenterSchema,
  updateRenterSchema,
  updateRenterNotesSchema,
  createLeaseSchema,
} = require('../validators/renters');
const { UNIT_DESIGNATIONS, PROPERTY_TYPES } = require('../constants/properties');
const { computeArrears, buildRentStrip, paymentPeriodKey } = require('../services/rentTracking');
const { toPublicInspectionReport, toPublicMoveOutReport } = require('../services/inspection');
const { toActor } = require('../utils/actor');
const { resolvePropertyScope, assertRenterInScope } = require('../services/scope');
const { hasAnyPermission } = require('../services/permissions');
const { toPublic: toPublicLeaseDeposit } = require('../services/leaseDeposits');
const { ADDITIONAL_DEPOSIT_TYPE_KEYS } = require('../constants/leaseDeposits');
const logger = require('../utils/logger');
const { isoDate } = require('../utils/dates');
const rentersService = require('../services/renters');

const router = Router();
router.use(requireAuth);

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) ? id : null;
}

// Lecture de la liste/fiche (nom, téléphone, adresse, statut du bail) :
// ouverte à tout employé authentifié de l'entreprise, même sans permission
// `locataires` assignée — un agent sans cette permission doit pouvoir
// consulter l'annuaire, seulement pas le gérer. `requireAuth` au niveau du
// router suffit déjà ; ce middleware ne fait donc rien de plus, mais reste
// nommé pour documenter l'intention sur les routes qui l'utilisent.
const canRead = (req, res, next) => next();
// Écriture (créer/modifier un locataire, ouvrir un bail) : réservé à qui gère
// la relation locataire (agent/DG).
const canManage = requirePermission('locataires');

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
const PROPERTY_TYPE_LABELS = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.key, t.label]));

function unitDesignationLabel(row) {
  return row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
}

function toPublicUnitSummary(row) {
  return {
    id: row.unit_id,
    code: row.unit_code,
    designation: row.designation,
    designationLabel: unitDesignationLabel(row),
    sonebMeterNumber: row.soneb_meter_number,
    sbeeMeterNumber: row.sbee_meter_number,
    furnished: !!row.furnished,
    property: {
      id: row.property_id,
      code: row.property_code,
      owner: { id: row.owner_id, name: row.owner_name, phone: row.owner_phone },
      address: row.address,
      type: row.property_type,
      typeLabel: PROPERTY_TYPE_LABELS[row.property_type] ?? row.property_type,
      levels: row.levels,
    },
  };
}

/** Cautions supplémentaires d'un bail (lignes brutes déjà groupées par l'appelant), dans l'ordre du catalogue. */
function sortedAdditionalDeposits(rows) {
  const byType = new Map((rows || []).map((r) => [r.type, r]));
  return ADDITIONAL_DEPOSIT_TYPE_KEYS.map((key) => byType.get(key)).filter(Boolean).map(toPublicLeaseDeposit);
}

function toPublicLease(row) {
  return {
    id: row.lease_id ?? row.id,
    monthlyRent: Number(row.lease_monthly_rent ?? row.monthly_rent),
    depositAmount: Number(row.deposit_amount),
    depositStatus: row.deposit_status,
    openingDebtAmount: Number(row.opening_debt_amount ?? 0),
    upToDateAtOnboarding: !!row.up_to_date_at_onboarding,
    entryFeeAmount: Number(row.entry_fee_amount ?? 0),
    entryFeeReceivedAt: row.entry_fee_received_at ? isoDate(row.entry_fee_received_at) : null,
    entryFeeReceivedMethod: row.entry_fee_received_method ?? null,
    // Prorata d'entrée (étape 42) — appartient au propriétaire (voir compte séquestre), distinct des
    // frais d'agence ci-dessus (100 % cabinet).
    entryProration: row.entry_proration ?? 'aucun',
    entryProrataAmount: Number(row.entry_prorata_amount ?? 0),
    entryProrataDays: row.entry_prorata_days ?? null,
    entryProrataDueDate: row.entry_prorata_due_date ? isoDate(row.entry_prorata_due_date) : null,
    entryProrataReceivedAt: row.entry_prorata_received_at ? isoDate(row.entry_prorata_received_at) : null,
    entryProrataReceivedMethod: row.entry_prorata_received_method ?? null,
    rentDueDay: row.rent_due_day,
    rentDueOffsetDays: row.rent_due_offset_days,
    // Reçu d'entrée (demande utilisateur, 2026-10-17) — `null` si rien n'a été payé à la signature
    // (voir `services/leaseEntryReceipt.js`). Le numéro suffit : la route de téléchargement ne prend
    // que l'id du bail, jamais celui du reçu.
    entryReceiptNumber: row.entry_receipt_number ?? null,
    rentTiming: row.rent_timing,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    status: row.lease_status ?? row.status,
    createdBy: toActor(row.lease_creator_first_name, row.lease_creator_last_name, row.lease_creator_role),
    createdAt: row.lease_created_at ?? row.created_at,
    unit: toPublicUnitSummary(row),
  };
}

function toPublicRenter(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    profession: row.profession,
    notes: row.notes,
    notesUpdatedBy: toActor(row.notes_updater_first_name, row.notes_updater_last_name, row.notes_updater_role),
    notesUpdatedAt: row.notes_updated_at,
    createdBy: toActor(row.renter_creator_first_name, row.renter_creator_last_name, row.renter_creator_role),
    createdAt: row.created_at,
    // Jamais le token/hash lui-même ici (uniquement renvoyé une fois, à la
    // création du lien) — juste de quoi afficher « Générer » ou « Régénérer ».
    hasPortalLink: !!row.portal_token_hash,
    portalLinkCreatedAt: row.portal_link_created_at,
  };
}

const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  caution: 'Prélevé sur la caution',
};
// GET /api/renters — liste avec bail actif et statut de paiement.
router.get('/', canRead, async (req, res, next) => {
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { rows, paymentsByLease, lastEndedLeaseRowByRenter } = await rentersService.listRenters(req.user.tenantId, scopeAgentId);

    const lastEndedLeaseByRenter = new Map();
    for (const [renterId, r] of lastEndedLeaseRowByRenter) {
      lastEndedLeaseByRenter.set(renterId, {
        unitCode: r.unit_code,
        designationLabel: unitDesignationLabel(r),
        ownerName: r.owner_name,
        address: r.address,
        monthlyRent: Number(r.monthly_rent),
        endDate: isoDate(r.end_date),
      });
    }

    const renters = rows.map((row) => {
      const renter = toPublicRenter(row);
      if (!row.lease_id) {
        return {
          ...renter,
          activeLease: null,
          arrears: null,
          rentStrip: null,
          lastEndedLease: lastEndedLeaseByRenter.get(row.id) ?? null,
        };
      }
      const lease = toPublicLease(row);
      const rhythm = { mode: lease.rentDueDay != null ? 'calendaire' : 'jour_fixe' };
      const leasePayments = paymentsByLease.get(row.lease_id) || [];
      const arrears = computeArrears({
        startDate: lease.startDate,
        createdAt: lease.createdAt,
        upToDateAtOnboarding: lease.upToDateAtOnboarding,
        rentDueDay: lease.rentDueDay,
        rentDueOffsetDays: lease.rentDueOffsetDays,
        rentTiming: lease.rentTiming,
        monthlyRent: lease.monthlyRent,
        entryProration: lease.entryProration,
        payments: leasePayments,
        rhythm,
      });
      // Frise des 12 mois (état de chaque mois) — même source que le retard ci-dessus.
      const rentStrip = buildRentStrip({
        startDate: lease.startDate,
        endDate: lease.endDate,
        createdAt: lease.createdAt,
        upToDateAtOnboarding: lease.upToDateAtOnboarding,
        rentDueDay: lease.rentDueDay,
        rentDueOffsetDays: lease.rentDueOffsetDays,
        rentTiming: lease.rentTiming,
        monthlyRent: lease.monthlyRent,
        entryProration: lease.entryProration,
        payments: leasePayments,
        rhythm,
      });
      return { ...renter, activeLease: lease, arrears, rentStrip, lastEndedLease: null };
    });

    res.json({ renters });
  } catch (err) {
    next(err);
  }
});

// GET /api/renters/:id — fiche complète (baux, paiements, quittances, état des lieux).
router.get('/:id', canRead, async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await assertRenterInScope(req.user.tenantId, id, scopeAgentId);

    // Détail financier (historique des paiements, dette initiale réglée, cautions supplémentaires) :
    // contrairement à l'annuaire (nom/téléphone/adresse/statut du bail, voir `canRead`), réservé à qui
    // gère réellement la relation locataire ou la comptabilité. Faille trouvée à l'audit du 2026-10-23 :
    // tout le ledger était jusqu'ici servi à n'importe quel employé connecté. `arrears`/`rentStrip`
    // (statut : en retard ou non) restent calculés et visibles pour tous — c'est le STATUT du bail,
    // explicitement couvert par l'intention d'origine, pas le détail des transactions.
    const canSeeFinancials = await hasAnyPermission(req.user, 'locataires', 'comptabilite');

    const detail = await rentersService.getRenterDetail(req.user.tenantId, id);
    const { receiptsByPayment } = detail;

    const openingDebtPaymentsByLease = new Map();
    for (const [leaseId, list] of detail.openingDebtPaymentsByLease) {
      openingDebtPaymentsByLease.set(
        leaseId,
        list.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paymentMethod: p.payment_method,
          paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
          paidAt: isoDate(p.paid_at),
          notes: p.notes,
          recordedBy: toActor(p.recorder_first_name, p.recorder_last_name, p.recorder_role),
        })),
      );
    }

    const paymentsByLease = new Map();
    for (const [leaseId, list] of detail.paymentsByLease) {
      paymentsByLease.set(
        leaseId,
        list.map((p) => {
          const receipt = receiptsByPayment.get(p.id);
          return {
            id: p.id,
            // Clé de période (étape 2c) : 'AAAA-MM' pour un bail calendaire, date de début 'AAAA-MM-JJ'
            // sinon — jamais `null`, le frontend sait libeller les deux (`monthLabelFr`).
            coversMonth: paymentPeriodKey(p),
            coversPeriodStart: isoDate(p.covers_period_start),
            amount: Number(p.amount),
            paymentMethod: p.payment_method,
            paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
            paidAt: isoDate(p.paid_at),
            notes: p.notes,
            // Paiement en ligne (FedaPay) : aucun employé ne l'a saisi (recorded_by NULL) — attribué au paiement en ligne.
            recordedBy: p.recorded_by == null
              ? { name: 'Paiement en ligne', role: 'en_ligne', roleLabel: 'FedaPay' }
              : toActor(p.recorder_first_name, p.recorder_last_name, p.recorder_role),
            receipt: receipt ? { id: receipt.id, number: receipt.receipt_number, issuedAt: receipt.issued_at } : null,
          };
        }),
      );
    }

    const leases = detail.leaseRows.map((row) => {
      const lease = toPublicLease(row);
      const payments = paymentsByLease.get(row.id) || [];
      const isActive = row.status === 'active';
      // Rythme DU BAIL, dérivé de ses colonnes (même règle que la liste ci-dessus) — sans lui, un bail
      // non-calendaire faisait planter toute la fiche (échéance calculée sur `rentDueDay` null).
      // `payments[].coversMonth` porte déjà la bonne clé de période (`paymentPeriodKey`).
      const rhythm = { mode: lease.rentDueDay != null ? 'calendaire' : 'jour_fixe' };
      const openingDebtPayments = openingDebtPaymentsByLease.get(row.id) || [];
      const openingDebtPaid = openingDebtPayments.reduce((sum, p) => sum + p.amount, 0);
      return {
        ...lease,
        payments: canSeeFinancials ? payments : [],
        additionalDeposits: canSeeFinancials ? sortedAdditionalDeposits(detail.additionalDepositsByLease.get(row.id)) : [],
        arrears: isActive
          ? computeArrears({
              startDate: lease.startDate,
              createdAt: lease.createdAt,
              upToDateAtOnboarding: lease.upToDateAtOnboarding,
              rentDueDay: lease.rentDueDay,
              rentDueOffsetDays: lease.rentDueOffsetDays,
              rentTiming: lease.rentTiming,
              monthlyRent: lease.monthlyRent,
              entryProration: lease.entryProration,
              payments,
              rhythm,
            })
          : null,
        // Frise des 12 mois — seulement pour un bail actif (un bail terminé n'a plus d'échéance à suivre).
        rentStrip: isActive
          ? buildRentStrip({
              startDate: lease.startDate,
              endDate: lease.endDate,
              createdAt: lease.createdAt,
              upToDateAtOnboarding: lease.upToDateAtOnboarding,
              rentDueDay: lease.rentDueDay,
              rentDueOffsetDays: lease.rentDueOffsetDays,
              rentTiming: lease.rentTiming,
              monthlyRent: lease.monthlyRent,
              entryProration: lease.entryProration,
              payments,
              rhythm,
            })
          : null,
        openingDebtPaid,
        openingDebtRemaining: lease.openingDebtAmount - openingDebtPaid,
        openingDebtPayments: canSeeFinancials ? openingDebtPayments : [],
        moveInReport: toPublicInspectionReport(detail.moveInByLease.get(row.id)),
        moveOutReport: toPublicMoveOutReport(detail.moveOutByLease.get(row.id)),
      };
    });

    res.json({
      renter: toPublicRenter(detail.renterRow),
      canSeeFinancials,
      leases,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/renters — création d'un locataire + bail sur une unité libre existante.
router.post('/', canManage, async (req, res, next) => {
  const parsed = createRenterSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const created = await rentersService.createRenter(req.user.tenantId, req.user.id, scopeAgentId, data);
    logger.info('Locataire créé', {
      tenantId: req.user.tenantId,
      renterId: created.renterId,
      leaseId: created.leaseId,
      unitId: data.unitId,
      by: req.user.id,
    });
    res.status(201).json({
      renterId: created.renterId,
      leaseId: created.leaseId,
      unitId: data.unitId,
      // Détail du prorata d'entrée (étape 42) — pour que l'écran confirme précisément ce qui vient
      // d'être ajouté au compte séquestre du propriétaire, jamais un simple « bail créé » muet.
      entryProrata: created.entryProrata,
      additionalDeposits: created.additionalDeposits,
      entryReceipt: created.entryReceipt ? { id: created.entryReceipt.id, number: created.entryReceipt.receiptNumber } : null,
      portalLink: { token: created.portalToken, path: `/portail/${created.portalToken}` },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/renters/:id — mise à jour de l'identité du locataire.
router.patch('/:id', canManage, async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateRenterSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const row = await rentersService.updateRenter(req.user.tenantId, id, scopeAgentId, parsed.data);
    res.json({ renter: toPublicRenter(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/renters/:id/notes — note interne libre sur la situation du locataire (ex. « paie
// toujours en retard », « préfère être contacté le soir »). Volontairement SANS la permission
// "locataires" (contrairement à PATCH /:id ci-dessus, qui modifie l'identité) : demande explicite de
// l'utilisateur — un comptable ou un agent qui n'a pas le droit de modifier la fiche doit quand même
// pouvoir y laisser une observation, visible ensuite par toute l'équipe (y compris la direction) sur
// la fiche. `requireAuth` (déjà appliqué à tout ce routeur) suffit donc comme seule barrière ; la
// portée agent (un Bien hors de son périmètre) reste quand même vérifiée, comme pour la lecture.
router.patch('/:id/notes', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateRenterNotesSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const row = await rentersService.updateRenterNotes(req.user.tenantId, req.user.id, id, scopeAgentId, parsed.data.notes);
    logger.info('Note locataire modifiée', { tenantId: req.user.tenantId, renterId: id, by: req.user.id });
    res.json({ renter: toPublicRenter(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/renters/:id/leases — nouveau bail sur une unité libre (renouvellement / changement d'unité).
router.post('/:id/leases', canManage, async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createLeaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const created = await rentersService.createLease(req.user.tenantId, req.user.id, id, scopeAgentId, data);
    logger.info('Nouveau bail', { tenantId: req.user.tenantId, renterId: id, leaseId: created.leaseId, unitId: data.unitId, by: req.user.id });
    res.status(201).json({
      leaseId: created.leaseId,
      unitId: data.unitId,
      entryProrata: created.entryProrata,
      additionalDeposits: created.additionalDeposits,
      entryReceipt: created.entryReceipt ? { id: created.entryReceipt.id, number: created.entryReceipt.receiptNumber } : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/renters/:id/portal-link — (ré)génère le lien secret du portail
// locataire (accès en lecture à ses paiements/quittances/contrat + signalement
// d'incident, sans compte, sans mot de passe). Un seul lien valide à la fois :
// régénérer révoque immédiatement l'ancien. Le token en clair n'est renvoyé qu'ici,
// une seule fois — seule son empreinte est conservée (voir `utils/tokens.js`).
router.post('/:id/portal-link', canManage, async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const token = await rentersService.regeneratePortalLink(req.user.tenantId, id, scopeAgentId);

    logger.info('Lien du portail locataire (re)généré', {
      tenantId: req.user.tenantId,
      renterId: id,
      by: req.user.id,
    });
    res.status(201).json({ token, path: `/portail/${token}` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
