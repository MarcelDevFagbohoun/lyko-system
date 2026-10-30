'use strict';

const { Router } = require('express');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { createChargeSchema, updateChargeSchema, createUtilityPaymentSchema, deleteReasonSchema } = require('../validators/charges');
const { UTILITY_TYPES, UTILITY_TYPE_KEYS, CHARGE_STATUSES } = require('../constants/charges');
const { toActor } = require('../utils/actor');
const { resolvePropertyScope } = require('../services/scope');
const logger = require('../utils/logger');
const charges = require('../services/utilityCharges');
const { requireChargesEnabled } = require('../middleware/chargesModule');
const { isoDate } = require('../utils/dates');

const router = Router();
// Catalogue de permissions dédié depuis l'étape 3 (`charges`, par défaut
// comptable) — module financier propre aux fluides, distinct de locataires
// ET de comptabilite.
router.use(requireAuth, requireChargesEnabled, requirePermission('charges'));
// Consulter les fiches de charges ne suffit pas à enregistrer quoi que ce soit (2026-10-26).
router.use((req, res, next) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : requirePermission('charges_enregistrer')(req, res, next)));


const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  caution: 'Prélevé sur la caution',
};

function toPublicCharge(row) {
  const amount = Number(row.amount);
  const lossShareAmount = Number(row.loss_share_amount ?? 0);
  const paidAmount = Number(row.paid_total ?? 0);
  return {
    id: row.id,
    utilityType: row.utility_type,
    periodStart: isoDate(row.period_start),
    periodEnd: isoDate(row.period_end),
    readingStart: row.reading_start,
    readingEnd: row.reading_end,
    consumption: row.reading_end - row.reading_start,
    unitPrice: Number(row.unit_price),
    amount,
    // Part de l'écart compteur/décompteur imputée à cette facture (étape 23,
    // 0 sauf répartition « prorata » activée sur ce Bien) — distincte de la
    // consommation mesurée pour un affichage séparé.
    lossShareAmount,
    consumptionAmount: amount - lossShareAmount,
    billedAt: isoDate(row.billed_at),
    status: row.status,
    paidAmount,
    remainingAmount: Math.max(0, amount - paidAmount),
    paidAt: isoDate(row.paid_at),
    paymentMethod: row.payment_method,
    paymentMethodLabel: row.payment_method ? PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method : null,
    notes: row.notes,
    recordedBy: toActor(row.recorder_first_name, row.recorder_last_name, row.recorder_role),
    paidRecordedBy: toActor(row.payer_first_name, row.payer_last_name, row.payer_role),
    lease: { id: row.lease_id, status: row.lease_status },
    renter: { id: row.renter_id, firstName: row.renter_first_name, lastName: row.renter_last_name, phone: row.renter_phone },
    unit: { id: row.unit_id, code: row.unit_code },
    property: { id: row.property_id, code: row.property_code },
    createdAt: row.created_at,
  };
}

function parseId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
}

// GET /api/charges/meta — catalogues pour construire les formulaires.
router.get('/meta', (_req, res) => {
  res.json({ utilityTypes: UTILITY_TYPES, statuses: CHARGE_STATUSES });
});

// GET /api/charges/previous-reading?leaseId=&utilityType= — index de fin de
// la dernière facture de ce bail pour ce fluide, pour préremplir l'index de
// début d'une nouvelle facture (jamais besoin de le ressaisir) — même
// principe que le relevé par immeuble (utilityReadings.js).
router.get('/previous-reading', async (req, res, next) => {
  const leaseId = Number(req.query.leaseId);
  const utilityType = typeof req.query.utilityType === 'string' ? req.query.utilityType : '';
  if (!Number.isInteger(leaseId) || leaseId <= 0) return next(new ApiError(400, 'Bail invalide'));
  if (!UTILITY_TYPE_KEYS.includes(utilityType)) return next(new ApiError(400, 'Fluide invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    res.json({ readingEnd: await charges.getPreviousReadingEnd(req.user.tenantId, leaseId, utilityType, scopeAgentId) });
  } catch (err) {
    next(err);
  }
});

// GET /api/charges?status=&utilityType=&leaseId=&propertyId=&q= — registre des charges SONEB/SBEE.
router.get('/', async (req, res, next) => {
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const utilityType = typeof req.query.utilityType === 'string' ? req.query.utilityType : '';
    const leaseId = Number(req.query.leaseId);
    const propertyId = Number(req.query.propertyId);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rows = await charges.listCharges(req.user.tenantId, scopeAgentId, {
      status: CHARGE_STATUSES.includes(status) ? status : '',
      utilityType: utilityType === 'soneb' || utilityType === 'sbee' ? utilityType : '',
      leaseId: Number.isInteger(leaseId) && leaseId > 0 ? leaseId : 0,
      propertyId: Number.isInteger(propertyId) && propertyId > 0 ? propertyId : 0,
      q,
    });
    res.json({ charges: rows.map(toPublicCharge) });
  } catch (err) {
    next(err);
  }
});

// GET /api/charges/unpaid-by-property — pour chaque Bien ayant au moins une facture SONEB/SBEE non
// soldée (impayée ou partielle) : nombre de factures et montant restant dû. Alimente le badge de la
// liste des biens et le résumé de la fiche d'un Bien (demande utilisateur, 2026-10-30).
router.get('/unpaid-by-property', async (req, res, next) => {
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const rows = await charges.getUnpaidSummaryByProperty(req.user.tenantId, scopeAgentId);
    res.json({ byProperty: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/charges/month-summary?month=AAAA-MM — encadré « Ce mois-ci » de la page Charges.
// Défaut : mois en cours.
router.get('/month-summary', async (req, res, next) => {
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const currentMonth = new Date().toISOString().slice(0, 7);
    const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : currentMonth;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, 'Mois invalide (AAAA-MM)');
    res.json(await charges.getMonthSummary(req.user.tenantId, scopeAgentId, month, currentMonth));
  } catch (err) {
    next(err);
  }
});

// POST /api/charges — enregistrer une facture SONEB/SBEE sur un bail actif.
router.post('/', async (req, res, next) => {
  const parsed = createChargeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const created = await charges.createCharge(req.user.tenantId, req.user.id, scopeAgentId, data);
    logger.info('Charge SONEB/SBEE enregistrée', {
      tenantId: req.user.tenantId,
      chargeId: created.chargeId,
      leaseId: data.leaseId,
      utilityType: data.utilityType,
      consumption: created.consumption,
      amount: created.amount,
      by: req.user.id,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/charges/:id — corriger une facture avant règlement.
router.patch('/:id', async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateChargeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const row = await charges.updateCharge(req.user.tenantId, id, scopeAgentId, parsed.data);
    res.json({ charge: toPublicCharge(row) });
  } catch (err) {
    next(err);
  }
});

// GET /api/charges/:id/payments — historique des règlements de cette facture.
router.get('/:id/payments', async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const rows = await charges.listChargePayments(req.user.tenantId, id, scopeAgentId);
    res.json({
      payments: rows.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paymentMethod: p.payment_method,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
        paidAt: isoDate(p.paid_at),
        notes: p.notes,
        recordedBy: toActor(p.recorder_first_name, p.recorder_last_name, p.recorder_role),
        createdAt: p.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/charges/:id/payments — enregistrer un règlement (total ou partiel).
router.post('/:id/payments', async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createUtilityPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { newStatus } = await charges.recordManualPayment(req.user.tenantId, req.user.id, id, scopeAgentId, data);
    logger.info('Règlement facture SONEB/SBEE enregistré', {
      tenantId: req.user.tenantId,
      chargeId: id,
      amount: data.amount,
      newStatus,
      by: req.user.id,
    });
    res.status(201).json({ charge: toPublicCharge(await charges.getChargeRow(req.user.tenantId, id)) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/charges/:id — suppression logique d'une facture mal saisie : la
// trace reste en base (visible du DG via /api/accounting/deleted-entries)
// avec une justification obligatoire, mais le montant sort des totaux.
router.delete('/:id', async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = deleteReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  }
  const { reason } = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await charges.deleteCharge(req.user.tenantId, req.user.id, id, scopeAgentId, reason);
    logger.info('Charge SONEB/SBEE supprimée (suppression logique)', {
      tenantId: req.user.tenantId,
      chargeId: id,
      by: req.user.id,
      reason,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/charges/:id/payment-links — génère un lien de paiement FedaPay
// pour cette facture, à envoyer à la main (WhatsApp) à un locataire sans
// portail actif. Même schéma de révélation unique que les liens de portail.
router.post('/:id/payment-links', async (req, res, next) => {
  const id = parseId(req);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const link = await charges.createPaymentLink(req.user.tenantId, req.user.id, id, scopeAgentId);
    logger.info('Lien de paiement (charge) généré', {
      tenantId: req.user.tenantId,
      chargeId: id,
      linkId: link.linkId,
      amount: link.remaining,
      by: req.user.id,
    });
    res.status(201).json({ token: link.token, path: `/payer/${link.token}`, amount: link.remaining });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
