'use strict';

const { Router } = require('express');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission, requireAnyPermission, requireRole } = require('../middleware/auth');
const {
  createOwnerSchema,
  updateOwnerSchema,
  createPayoutSchema,
  createChargeRemittanceSchema,
  cancelChargeRemittanceSchema,
  updateCommissionRateSchema,
  endMandateSchema,
  createDepositTransferSchema,
} = require('../validators/owners');
const { UNIT_DESIGNATIONS, PROPERTY_TYPES } = require('../constants/properties');
const { streamOwnerStatementPdf, streamUtilityCarnetPdf } = require('../services/pdf');
const { getEscrowBalances, getDepositsHeldByOwner, getUnpaidOpeningDebtByOwner, pickRateValidAt } = require('../services/commission');
const { toActor } = require('../utils/actor');
const { getChargeAccount, listRemittances } = require('../services/utilityRemittance');
const { getOwnerCarnet, resolveMonthWindow } = require('../services/utilityPoint');
const { resolvePropertyScope } = require('../services/scope');
const { hasAnyPermission } = require('../services/permissions');
const logger = require('../utils/logger');
const { isoDate } = require('../utils/dates');
const { requireFeature } = require('../services/entitlements');
const depositTransfers = require('../services/depositTransfers');
const owners = require('../services/owners');
const { pool } = require('../config/db');
const { requireChargesEnabled } = require('../middleware/chargesModule');

const router = Router();
router.use(requireAuth);

// Lecture du répertoire/de la fiche (nom, téléphone, patrimoine) : ouverte à
// tout employé authentifié, même sans permission `proprietaires` assignée —
// un agent doit pouvoir consulter, seulement pas gérer (même principe que
// les locataires). `requireAuth` au niveau du router suffit déjà.
const canRead = (req, res, next) => next();
// Relevé PDF généré à la demande : reste réservé à qui gère la relation
// propriétaire/locataire ou à la comptabilité, comme le contrat de bail.
const canReadDocs = requireAnyPermission('proprietaires', 'comptabilite', 'locataires');
// Créer/modifier une fiche propriétaire : propriétaires (module dédié) ou
// locataires (création à la volée d'un propriétaire depuis le formulaire
// Bien) — pas comptabilite, qui n'a pas vocation à modifier les fiches.
const canManage = requireAnyPermission('proprietaires', 'locataires');
// Enregistrer un versement : action financière (relation propriétaire),
// réservée à proprietaires/comptabilite — pas locataires, qui gère les
// Biens mais pas les flux d'argent vers les bailleurs.
// Permission dédiée (2026-10-26) : voir/gérer la fiche propriétaire ne permet pas de verser de l'argent.
const canPayout = requirePermission('reversements_proprietaires');
// Modifier le taux de commission : DG uniquement (cahier des charges), pas
// même le comptable — c'est une décision de gérance, pas une saisie.
const canCommission = requireRole('dg');
// Terminer/réactiver le mandat d'un propriétaire (demande utilisateur, 2026-10-18) : DG uniquement,
// même principe que le taux de commission ci-dessus — une décision de gérance.
const canMandate = requireRole('dg');

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
const PROPERTY_TYPE_LABELS = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.key, t.label]));

const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  caution: 'Prélevé sur la caution',
};


function toPublicOwner(row, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    createdBy: toActor(row.creator_first_name, row.creator_last_name, row.creator_role),
    createdAt: row.created_at,
    // Jamais le token/hash lui-même ici (uniquement renvoyé une fois, à la
    // création du lien) — juste de quoi afficher « Générer » ou « Régénérer ».
    hasPortalLink: !!row.portal_token_hash,
    portalLinkCreatedAt: row.portal_link_created_at,
    // Archive des propriétaires (demande utilisateur, 2026-10-18) — mandat terminé volontairement
    // par le DG, jamais automatique (voir `POST /:id/end-mandate`).
    mandateEndedAt: row.mandate_ended_at,
    mandateEndedBy: toActor(row.mandate_ender_first_name, row.mandate_ender_last_name, row.mandate_ender_role),
    mandateEndReason: row.mandate_end_reason,
    ...extra,
  };
}

function unitDesignationLabel(row) {
  return row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
}

function parseId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
}

// GET /api/owners?q=... — répertoire des propriétaires, avec patrimoine résumé.
router.get('/', canRead, async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    // Portée « Biens gérés » (étape 14) : un agent restreint ne voit que les propriétaires ayant AU MOINS
    // UN Bien qui lui est attribué, et le patrimoine résumé ne compte QUE ses propres Biens.
    const scopeAgentId = await resolvePropertyScope(req.user);
    const rows = await owners.listOwners(req.user.tenantId, scopeAgentId, q);
    res.json({
      owners: rows.map((r) =>
        toPublicOwner(r, {
          propertiesCount: Number(r.properties_count),
          unitsCount: Number(r.units_count),
          unitsOccupied: Number(r.units_occupied),
          monthlyRentTotal: Number(r.monthly_rent_total),
        }),
      ),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/owners/:id — fiche + ses biens/unités + historique des versements.
router.get('/:id', canRead, async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await owners.loadOwner(pool, req.user.tenantId, id, scopeAgentId);

    // Un agent restreint ne voit, dans la fiche du propriétaire, QUE ses propres Biens attribués.
    const propertyRows = await owners.listOwnerPropertyUnits(req.user.tenantId, id, scopeAgentId);

    const propertiesById = new Map();
    for (const row of propertyRows) {
      if (!propertiesById.has(row.id)) {
        propertiesById.set(row.id, {
          id: row.id,
          code: row.code,
          address: row.address,
          type: row.property_type,
          typeLabel: PROPERTY_TYPE_LABELS[row.property_type] ?? row.property_type,
          levels: row.levels,
          units: [],
        });
      }
      if (row.unit_id) {
        propertiesById.get(row.id).units.push({
          id: row.unit_id,
          code: row.unit_code,
          designationLabel: unitDesignationLabel(row),
          status: row.unit_status,
          monthlyRent: Number(row.monthly_rent),
          currentRenter: row.renter_first_name ? `${row.renter_first_name} ${row.renter_last_name}` : null,
        });
      }
    }

    // Détail FINANCIER (versements, taux de commission, séquestre, cautions, charges à reverser) :
    // contrairement à l'annuaire ci-dessus (nom/téléphone/patrimoine, voir `canRead`), réservé à qui
    // gère réellement la relation propriétaire ou la comptabilité (faille trouvée à l'audit du 2026-10-23).
    const canSeeFinancials = await hasAnyPermission(req.user, 'proprietaires', 'comptabilite', 'locataires');

    let commissionRates = [];
    let activeCommissionRate = null;
    let escrowBalance = { totalCollected: 0, totalPayouts: 0, balance: 0, chargeCredits: 0, breakdown: { rent: 0, openingDebt: 0, prorata: 0, expenses: 0 } };
    let depositsHeld = null;
    let depositPositions = null;
    let depositTransfersList = null;
    let openingDebtUnpaidForOwner = 0;
    let chargesAccount = null;
    let chargeRemittances = [];
    let payouts = [];

    if (canSeeFinancials) {
      const payoutRows = await owners.listOwnerPayouts(req.user.tenantId, id);
      payouts = payoutRows.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        periodLabel: p.period_label,
        paidAt: isoDate(p.paid_at),
        paymentMethod: p.payment_method,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
        notes: p.notes,
        recordedBy: toActor(p.recorded_by_first_name, p.recorded_by_last_name, p.recorded_by_role),
      }));

      const rateRows = await owners.listCommissionRates(req.user.tenantId, id);
      commissionRates = rateRows.map((r) => ({
        id: r.id,
        rate: Number(r.rate),
        startsOn: isoDate(r.starts_on),
        endsOn: isoDate(r.ends_on),
        setBy: toActor(r.set_by_first_name, r.set_by_last_name, r.set_by_role),
        createdAt: r.created_at,
      }));
      // Taux de commission actif AUJOURD'HUI — voir `pickRateValidAt` (services/commission.js).
      activeCommissionRate = pickRateValidAt(commissionRates, isoDate(new Date()));

      // Solde séquestre : combien le cabinet détient actuellement pour ce propriétaire, tous ses Biens
      // confondus — jamais scopé par agent (voir `getEscrowBalances`).
      const escrowBalances = await getEscrowBalances(req.user.tenantId);
      const escrow = escrowBalances.get(id) ?? escrowBalance;
      escrowBalance = {
        totalCollected: escrow.totalCollected,
        totalPayouts: escrow.totalPayouts,
        balance: escrow.balance,
        chargeCredits: escrow.chargeCredits ?? 0,
        breakdown: escrow.breakdown,
      };
      // Cautions détenues — à côté de la recette nette cumulée, jamais fondues dedans.
      depositsHeld = await getDepositsHeldByOwner(req.user.tenantId, id);
      const unpaidOpeningDebtByOwner = await getUnpaidOpeningDebtByOwner(req.user.tenantId);
      openingDebtUnpaidForOwner = unpaidOpeningDebtByOwner.get(id) ?? 0;
      // Charges SONEB/SBEE encaissées à reverser (étape 31) — jamais scopé par agent (comme le séquestre).
      chargesAccount = await getChargeAccount(pool, req.user.tenantId, id);
      const remittanceRows = await listRemittances(pool, req.user.tenantId, id, { limit: 100 });
      chargeRemittances = remittanceRows.map((r) => ({
        id: r.id,
        amount: r.amount,
        periodLabel: r.periodLabel,
        paidAt: r.paidAt,
        paymentMethod: r.paymentMethod,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod,
        kind: r.kind,
        notes: r.notes,
        recordedBy: toActor(r.byFirstName, r.byLastName, r.byRole),
        createdAt: r.createdAt,
      }));
      depositPositions = await depositTransfers.getDepositPositions(req.user.tenantId, id);
      depositTransfersList = await depositTransfers.listTransfers(req.user.tenantId, id, { limit: 50 });
    }

    res.json({
      owner: toPublicOwner(owner),
      properties: [...propertiesById.values()],
      canSeeFinancials,
      escrowBalance,
      // Cautions actuellement détenues — à part de la recette nette cumulée : ce n'est pas un revenu.
      depositsHeld,
      // Cautions : ce que le cabinet détient encore, ce qui a été remis au propriétaire, et l'historique.
      depositPositions,
      depositTransfers: depositTransfersList,
      // Dette initiale des locataires non encore réglée — volontairement à part du solde séquestre.
      openingDebtUnpaid: openingDebtUnpaidForOwner,
      chargesAccount,
      chargeRemittances,
      payouts,
      activeCommissionRate,
      commissionRates,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/owners — créer un propriétaire (fiche seule, sans bien).
router.post('/', canManage, async (req, res, next) => {
  const parsed = createOwnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const ownerId = await owners.createOwner(req.user.tenantId, req.user.id, parsed.data);
    logger.info('Propriétaire créé', { tenantId: req.user.tenantId, ownerId, by: req.user.id });
    res.status(201).json({ ownerId });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/owners/:id — modifier la fiche.
router.patch('/:id', canManage, async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateOwnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const updated = await owners.updateOwner(req.user.tenantId, id, scopeAgentId, parsed.data);
    res.json({ owner: toPublicOwner(updated) });
  } catch (err) {
    next(err);
  }
});

// POST /api/owners/:id/payouts — enregistrer un versement (loyers nets reversés).
router.post('/:id/payouts', canPayout, async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createPayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const payoutId = await owners.createPayout(req.user.tenantId, req.user.id, id, scopeAgentId, parsed.data);
    logger.info('Versement propriétaire enregistré', {
      tenantId: req.user.tenantId,
      ownerId: id,
      payoutId,
      by: req.user.id,
    });
    res.status(201).json({ payoutId });
  } catch (err) {
    next(err);
  }
});

// GET /api/owners/:id/deposit-transfers — cautions détenues (par bail et par type) et historique des reversements.
router.get('/:id/deposit-transfers', canRead, async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    res.json(await owners.getDepositTransferOverview(req.user.tenantId, id, scopeAgentId));
  } catch (err) {
    next(err);
  }
});

// POST /api/owners/:id/deposit-transfers — reverser une caution au propriétaire (ou la récupérer auprès de lui).
// Ce n'est pas une recette du propriétaire : ni solde séquestre, ni commission. Motif obligatoire.
router.post('/:id/deposit-transfers', canPayout, async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = createDepositTransferSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const transferId = await owners.createDepositTransfer(req.user.tenantId, req.user.id, id, scopeAgentId, data);
    logger.info('Caution reversée au propriétaire', { tenantId: req.user.tenantId, ownerId: id, transferId, direction: data.direction, by: req.user.id });
    res.status(201).json({ transferId });
  } catch (err) {
    next(err);
  }
});

// POST /api/owners/:id/charge-remittances — reverser au propriétaire des
// charges SONEB/SBEE déjà encaissées chez ses locataires (étape 31). Le solde
// est réévalué DANS la transaction, sous verrou de la fiche propriétaire :
// deux reversements simultanés ne peuvent pas dépasser ensemble ce qui a été
// encaissé. Aucune écriture comptable automatique — voir migration 063.
router.post('/:id/charge-remittances', requireChargesEnabled, canPayout, async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createChargeRemittanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const remittanceId = await owners.createChargeRemittance(req.user.tenantId, req.user.id, id, scopeAgentId, data);
    logger.info('Reversement de charges au propriétaire enregistré', {
      tenantId: req.user.tenantId,
      ownerId: id,
      remittanceId,
      amount: data.amount,
      by: req.user.id,
    });
    res.status(201).json({
      remittanceId,
      accountingNote: null,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/owners/:id/charge-remittances/:remittanceId  { reason } — annulation
// logique d'un reversement mal saisi : la trace reste, le montant redevient « à reverser ».
router.delete('/:id/charge-remittances/:remittanceId', requireChargesEnabled, canPayout, async (req, res, next) => {
  const id = parseId(req);
  const remittanceId = Number(req.params.remittanceId);
  if (id === null || !Number.isInteger(remittanceId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = cancelChargeRemittanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await owners.cancelChargeRemittance(req.user.tenantId, req.user.id, id, remittanceId, scopeAgentId, parsed.data.reason);
    logger.info('Reversement de charges annulé', {
      tenantId: req.user.tenantId,
      ownerId: id,
      remittanceId,
      by: req.user.id,
      reason: parsed.data.reason,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// PUT /api/owners/:id/commission-rate — nouveau taux de commission (DG uniquement).
router.put('/:id/commission-rate', canCommission, async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateCommissionRateSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const startsOn = parsed.data.startsOn ?? new Date().toISOString().slice(0, 10);

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { rateId, previousClosedId } = await owners.setCommissionRate(req.user.tenantId, req.user.id, id, scopeAgentId, {
      rate: parsed.data.rate,
      startsOn,
    });
    logger.info('Taux de commission modifié', {
      tenantId: req.user.tenantId,
      ownerId: id,
      rateId,
      rate: parsed.data.rate,
      startsOn,
      previousClosedId,
      by: req.user.id,
    });
    res.status(201).json({ rateId, rate: parsed.data.rate, startsOn, endsOn: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/owners/:id/carnet-charges.pdf?from=AAAA-MM&to=AAAA-MM — carnet des
// charges SONEB/SBEE (point par relevé, entrées, reversements). Employé :
// téléchargements illimités, sans code de vérification (comme le relevé).
router.get('/:id/carnet-charges.pdf', requireChargesEnabled, requireAnyPermission('charges', 'proprietaires', 'comptabilite'), async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const { fromMonth, toMonth } = resolveMonthWindow(req.query.from, req.query.to);
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await owners.loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    const carnet = await getOwnerCarnet(req.user.tenantId, id, { fromMonth, toMonth, scopeAgentId });
    streamUtilityCarnetPdf(res, { tenant: await owners.getTenantRow(req.user.tenantId), owner, carnet });
  } catch (err) {
    next(err);
  }
});

// GET /api/owners/:id/statement.pdf — relevé (patrimoine + historique des versements).
router.get('/:id/statement.pdf', canReadDocs, requireFeature('owner_portal'), async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await owners.loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    // Même règle que la fiche : un agent restreint ne fait figurer que ses propres Biens dans le relevé.
    const { unitRows, payoutRows } = await owners.loadStatementData(id, scopeAgentId);
    const tenant = await owners.getTenantRow(req.user.tenantId);

    // Charges SONEB/SBEE des 6 derniers mois (étape 31) — dans la portée de l'agent, comme les unités.
    const { fromMonth, toMonth } = resolveMonthWindow();
    const charges = await getOwnerCarnet(req.user.tenantId, id, { fromMonth, toMonth, scopeAgentId });

    const [positions, transferRows] = await Promise.all([
      depositTransfers.getDepositPositions(req.user.tenantId, id),
      depositTransfers.listTransfers(req.user.tenantId, id, { limit: 24 }),
    ]);

    streamOwnerStatementPdf(res, {
      tenant,
      owner,
      charges,
      units: unitRows.map((u) => ({
        propertyCode: u.property_code,
        address: u.address,
        unitCode: u.unit_code,
        designationLabel: unitDesignationLabel(u),
        status: u.status,
        monthlyRent: Number(u.monthly_rent),
        currentRenter: u.renter_first_name ? `${u.renter_first_name} ${u.renter_last_name}` : null,
      })),
      depositTransfers: { withOwner: positions.withOwnerTotal, rows: transferRows },
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

// POST /api/owners/:id/portal-link — (ré)génère le lien secret du portail
// propriétaire (étape 13, idée n°1) : recette du mois, versements, relevé
// PDF, sans compte ni mot de passe. Un seul lien valide à la fois —
// régénérer révoque immédiatement l'ancien. Le token en clair n'est renvoyé
// qu'ici, une seule fois (même principe que le portail locataire).
router.post('/:id/portal-link', canManage, requireFeature('owner_portal'), async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const token = await owners.regeneratePortalLink(req.user.tenantId, id, scopeAgentId);
    logger.info('Lien du portail propriétaire (re)généré', { tenantId: req.user.tenantId, ownerId: id, by: req.user.id });
    res.status(201).json({ token, path: `/portail/proprietaire/${token}` });
  } catch (err) {
    next(err);
  }
});

// POST /api/owners/:id/end-mandate — archive ce propriétaire (demande utilisateur, 2026-10-18) :
// action volontaire du DG, jamais automatique sur « 0 Bien ». Motif obligatoire, bloquée tant qu'il
// reste au moins un Bien rattaché (il faut d'abord les réattribuer/supprimer) — un mandat terminé ne
// doit jamais laisser un Bien sans propriétaire géré. La fiche devient ensuite en lecture seule
// (`assertMandateActive`) jusqu'à une éventuelle réactivation.
router.post('/:id/end-mandate', canMandate, async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = endMandateSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const updated = await owners.endMandate(req.user.tenantId, req.user.id, id, parsed.data.reason);
    logger.info('Mandat propriétaire terminé', { tenantId: req.user.tenantId, ownerId: id, by: req.user.id });
    res.json({ owner: toPublicOwner(updated) });
  } catch (err) {
    next(err);
  }
});

// POST /api/owners/:id/reactivate-mandate — unique porte de sortie de l'archive (ex. un règlement
// tardif après le départ). DG uniquement, aucune précondition (toujours possible).
router.post('/:id/reactivate-mandate', canMandate, async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const updated = await owners.reactivateMandate(req.user.tenantId, id);
    logger.info('Mandat propriétaire réactivé', { tenantId: req.user.tenantId, ownerId: id, by: req.user.id });
    res.json({ owner: toPublicOwner(updated) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
