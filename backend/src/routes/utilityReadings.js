'use strict';

/**
 * Étape 9bis — Relevé de compteurs par immeuble (SONEB / SBEE).
 *
 * Un relevé = (immeuble, fluide, période). Il porte le compteur principal +
 * un tarif figé, et une ligne par unité sous-comptée (décompteur). Sa
 * validation génère une facture `utility_charges` (impayée) pour chaque unité
 * rattachée à un bail actif. La différence compteur principal / Σ décompteurs
 * est calculée et affichée (jamais refacturée — décision de l'utilisateur).
 * Les requêtes et règles métier vivent dans `services/utilityReadings.js`.
 */

const { Router } = require('express');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { utilityConfigSchema, createBatchSchema, saveBatchSchema, mainPaymentSchema } = require('../validators/charges');
const { UTILITY_TYPE_KEYS } = require('../constants/charges');
const { UNIT_DESIGNATIONS } = require('../constants/properties');
const { toActor } = require('../utils/actor');
const { resolvePropertyScope } = require('../services/scope');
const { resolveMonthWindow } = require('../services/utilityPoint');
const { listUtilityAlerts } = require('../services/utilityAlerts');
const readings = require('../services/utilityReadings');
const logger = require('../utils/logger');

const { requireChargesEnabled } = require('../middleware/chargesModule');
const { isoDate } = require('../utils/dates');
const router = Router();
router.use(requireAuth, requireChargesEnabled, requirePermission('charges'));
// Consulter les fiches de charges ne suffit pas à enregistrer quoi que ce soit (2026-10-26).
router.use((req, res, next) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : requirePermission('charges_enregistrer')(req, res, next)));

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
const num = (v) => (v == null ? null : Number(v));

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) ? id : null;
}

function toPublicBatch(batch, rows, point = null) {
  return {
    batch: {
      id: batch.id,
      propertyId: batch.property_id,
      propertyCode: batch.property_code,
      utilityType: batch.utility_type,
      periodStart: isoDate(batch.period_start),
      periodEnd: isoDate(batch.period_end),
      unitPrice: Number(batch.unit_price),
      status: batch.status,
      validatedAt: batch.validated_at ? new Date(batch.validated_at).toISOString() : null,
      // Répartition de l'écart configurée sur ce Bien pour ce fluide (étape
      // 23) — informative ici, appliquée réellement à la validation.
      lossAllocation: batch.loss_allocation,
      main: {
        readingStart: batch.main_reading_start,
        readingEnd: batch.main_reading_end,
        consumption:
          batch.main_reading_start != null && batch.main_reading_end != null
            ? batch.main_reading_end - batch.main_reading_start
            : null,
        invoiceAmount: num(batch.main_invoice_amount),
        // Paiement de la facture mère par le propriétaire (étape 30) — mémo.
        payment:
          batch.main_paid_amount != null
            ? {
                amount: Number(batch.main_paid_amount),
                paidAt: isoDate(batch.main_paid_at),
                paymentMethod: batch.main_paid_method,
                notes: batch.main_paid_notes,
                recordedAt: batch.main_paid_recorded_at ? new Date(batch.main_paid_recorded_at).toISOString() : null,
                recordedBy: toActor(batch.main_paid_by_first_name, batch.main_paid_by_last_name, batch.main_paid_by_role),
              }
            : null,
      },
      recordedBy: toActor(batch.recorder_first_name, batch.recorder_last_name, batch.recorder_role),
    },
    rows: rows.map((r) => ({
      unitId: r.unit_id,
      unitCode: r.unit_code,
      unitLabel: r.designation === 'autre' ? r.designation_custom || 'Autre' : DESIGNATION_LABELS[r.designation] || r.designation,
      meterNumber: r.meter_number,
      lease: r.active_lease_id ? { id: r.active_lease_id, status: r.active_lease_status } : null,
      renter: r.renter_first_name ? { firstName: r.renter_first_name, lastName: r.renter_last_name } : null,
      previousReading: r.previous_reading != null ? Number(r.previous_reading) : null,
      readingStart: r.reading_start,
      readingEnd: r.reading_end,
      consumption: r.reading_end - r.reading_start,
      amount: Number(r.amount),
      // Étape 51bis (Basse #3) : `r.charge_id` (colonne brute de `utility_readings`) n'est jamais effacée
      // après une suppression logique de la facture — `live_charge_id` (jointure filtrée sur
      // `deleted_at IS NULL`) est le vrai indicateur qu'une facture existe ENCORE réellement, sinon
      // l'écran du relevé affichait une facture « fantôme » déjà invisible partout ailleurs.
      charge: r.live_charge_id ? { id: r.live_charge_id, status: r.charge_status } : null,
    })),
    totals: readings.computeTotals(batch, rows),
    point,
  };
}

/** Charge le relevé et répond avec sa mise en forme publique. */
async function respondBatch(res, tenantId, batchId, scopeAgentId = null) {
  const { batch, rows, point } = await readings.getBatch(tenantId, batchId, scopeAgentId);
  res.json(toPublicBatch(batch, rows, point));
}

// ── Configuration du sous-comptage d'un Bien ─────────────────────────────

// PATCH /api/properties/:propertyId/utility-config
router.patch('/properties/:propertyId/utility-config', async (req, res, next) => {
  const propertyId = parseId(req.params.propertyId);
  if (propertyId === null) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = utilityConfigSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const p = await readings.updateUtilityConfig(req.user.tenantId, propertyId, scopeAgentId, parsed.data);
    res.json({
      utilityConfig: {
        soneb: {
          submetered: !!p.soneb_submetered,
          unitPrice: num(p.soneb_unit_price),
          mainMeterNumber: p.soneb_main_meter_number,
          accountNumber: p.soneb_account_number,
          lossAllocation: p.soneb_loss_allocation,
        },
        sbee: {
          submetered: !!p.sbee_submetered,
          unitPrice: num(p.sbee_unit_price),
          mainMeterNumber: p.sbee_main_meter_number,
          accountNumber: p.sbee_account_number,
          lossAllocation: p.sbee_loss_allocation,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── Relevés ─────────────────────────────────────────────────────────────

// GET /api/properties/:propertyId/utility-batches?utilityType=soneb
router.get('/properties/:propertyId/utility-batches', async (req, res, next) => {
  const propertyId = parseId(req.params.propertyId);
  if (propertyId === null) return next(new ApiError(400, 'Identifiant invalide'));
  const utilityType = typeof req.query.utilityType === 'string' ? req.query.utilityType : null;
  if (utilityType && !UTILITY_TYPE_KEYS.includes(utilityType)) return next(new ApiError(400, 'Fluide invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const rows = await readings.listBatches(req.user.tenantId, propertyId, scopeAgentId, utilityType);
    res.json({
      batches: rows.map((b) => {
        const mainConsumption =
          b.main_reading_start != null && b.main_reading_end != null ? b.main_reading_end - b.main_reading_start : null;
        const mainAmount = num(b.main_invoice_amount);
        const subConsumption = Number(b.sub_consumption);
        const subAmount = Number(b.sub_amount);
        return {
          id: b.id,
          utilityType: b.utility_type,
          periodStart: isoDate(b.period_start),
          periodEnd: isoDate(b.period_end),
          unitPrice: Number(b.unit_price),
          status: b.status,
          validatedAt: b.validated_at ? new Date(b.validated_at).toISOString() : null,
          rowCount: Number(b.row_count),
          subConsumption,
          subAmount,
          mainConsumption,
          mainAmount,
          mainPaidAmount: num(b.main_paid_amount),
          differenceConsumption: mainConsumption != null ? mainConsumption - subConsumption : null,
          differenceAmount: mainAmount != null ? mainAmount - subAmount : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/properties/:propertyId/utility-batches  { utilityType, periodStart, periodEnd }
router.post('/properties/:propertyId/utility-batches', async (req, res, next) => {
  const propertyId = parseId(req.params.propertyId);
  if (propertyId === null) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = createBatchSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { batchId, unitsCount } = await readings.createBatch(req.user.tenantId, req.user.id, propertyId, scopeAgentId, parsed.data);
    logger.info('Relevé de compteurs créé', {
      tenantId: req.user.tenantId,
      batchId,
      propertyId,
      utilityType: parsed.data.utilityType,
      units: unitsCount,
    });
    await respondBatch(res, req.user.tenantId, batchId);
  } catch (err) {
    next(err);
  }
});

// GET /api/utility-batches/:id
router.get('/utility-batches/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await respondBatch(res, req.user.tenantId, id, scopeAgentId);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/utility-batches/:id  { mainReadingStart?, mainReadingEnd?, mainInvoiceAmount?, readings:[{unitId,readingStart,readingEnd}] }
router.patch('/utility-batches/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = saveBatchSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await readings.saveBatch(req.user.tenantId, id, scopeAgentId, parsed.data);
    await respondBatch(res, req.user.tenantId, id);
  } catch (err) {
    next(err);
  }
});

// PUT /api/utility-batches/:id/main-payment  { amount, paidAt, paymentMethod?, notes? }
// Enregistre (ou corrige) le paiement de la facture mère par le propriétaire.
// Mémo pur : aucun mouvement de caisse du cabinet, donc ni verrou de période
// ni écriture comptable.
router.put('/utility-batches/:id/main-payment', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = mainPaymentSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await readings.setMainPayment(req.user.tenantId, req.user.id, id, scopeAgentId, parsed.data);
    logger.info('Paiement de la facture mère enregistré', { tenantId: req.user.tenantId, batchId: id, amount: parsed.data.amount, by: req.user.id });
    await respondBatch(res, req.user.tenantId, id, scopeAgentId);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/utility-batches/:id/main-payment — annule la déclaration de paiement.
router.delete('/utility-batches/:id/main-payment', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await readings.clearMainPayment(req.user.tenantId, id, scopeAgentId);
    logger.info('Paiement de la facture mère annulé', { tenantId: req.user.tenantId, batchId: id, by: req.user.id });
    await respondBatch(res, req.user.tenantId, id, scopeAgentId);
  } catch (err) {
    next(err);
  }
});

// GET /api/utility-point?ownerId=&propertyId=&from=YYYY-MM&to=YYYY-MM
// Le point des charges : facture mère payée vs encaissé chez les locataires,
// par propriétaire. Défaut : les 6 derniers mois (mois de début du relevé).
// Avec `ownerId` : renvoie en plus le carnet complet de ce propriétaire
// (entrées, reversements, solde à reverser). Le solde à reverser est un solde
// de bout en bout d'un propriétaire : jamais exposé à un agent restreint.
router.get('/utility-point', async (req, res, next) => {
  try {
    const ownerId = req.query.ownerId != null ? Number(req.query.ownerId) : null;
    const propertyId = req.query.propertyId != null ? Number(req.query.propertyId) : null;
    if ((ownerId != null && !Number.isInteger(ownerId)) || (propertyId != null && !Number.isInteger(propertyId))) {
      throw new ApiError(400, 'Identifiant invalide');
    }
    const { fromMonth, toMonth } = resolveMonthWindow(req.query.from, req.query.to);

    const scopeAgentId = await resolvePropertyScope(req.user);
    const result = await readings.getPointOverview(req.user.tenantId, { ownerId, propertyId, fromMonth, toMonth, scopeAgentId });
    res.json({ from: fromMonth, to: toMonth, ...result });
  } catch (err) {
    next(err);
  }
});

// GET /api/utility-alerts — ce qui fait perdre de l'argent au propriétaire ou
// laisse le carnet incomplet (voir services/utilityAlerts.js).
router.get('/utility-alerts', async (req, res, next) => {
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const alerts = await listUtilityAlerts(req.user.tenantId, { scopeAgentId });
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// POST /api/utility-batches/:id/validate — génère les factures, verrouille.
router.post('/utility-batches/:id/validate', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { generated, lossAllocation, lossDistributed } = await readings.validateBatch(req.user.tenantId, req.user.id, id, scopeAgentId);
    logger.info('Relevé de compteurs validé', {
      tenantId: req.user.tenantId,
      batchId: id,
      chargesGenerated: generated,
      lossAllocation,
      lossDistributed,
      by: req.user.id,
    });
    await respondBatch(res, req.user.tenantId, id);
  } catch (err) {
    next(err);
  }
});

// POST /api/utility-batches/:id/reopen — supprime les factures NON PAYÉES, repasse en brouillon.
router.post('/utility-batches/:id/reopen', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { chargesDeleted } = await readings.reopenBatch(req.user.tenantId, id, scopeAgentId);
    logger.info('Relevé de compteurs rouvert', { tenantId: req.user.tenantId, batchId: id, chargesDeleted, by: req.user.id });
    await respondBatch(res, req.user.tenantId, id);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/utility-batches/:id — uniquement un brouillon.
router.delete('/utility-batches/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await readings.deleteBatch(req.user.tenantId, id, scopeAgentId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
