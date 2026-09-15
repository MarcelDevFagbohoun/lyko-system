'use strict';

/**
 * Étape 9bis — Relevé de compteurs par immeuble (SONEB / SBEE).
 *
 * Un relevé = (immeuble, fluide, période). Il porte le compteur principal +
 * un tarif figé, et une ligne par unité sous-comptée (décompteur). Sa
 * validation génère une facture `utility_charges` (impayée) pour chaque unité
 * rattachée à un bail actif. La différence compteur principal / Σ décompteurs
 * est calculée et affichée (jamais refacturée — décision de l'utilisateur).
 */

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { utilityConfigSchema, createBatchSchema, saveBatchSchema } = require('../validators/charges');
const { UTILITY_TYPE_KEYS, DIFFERENCE_ALERT_PCT } = require('../constants/charges');
const { UNIT_DESIGNATIONS } = require('../constants/properties');
const { toActor } = require('../utils/actor');
const { assertPeriodOpen, isPeriodClosed } = require('../services/accountingPeriods');
const { resolvePropertyScope } = require('../services/scope');
const logger = require('../utils/logger');

const router = Router();
router.use(requireAuth, requirePermission('charges'));

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const num = (v) => (v == null ? null : Number(v));

// ── Helpers ──────────────────────────────────────────────────────────────

/** `scopeAgentId` (étape 14) : un agent restreint n'accède qu'à ses propres Biens. */
async function loadProperty(tenantId, propertyId, scopeAgentId = null) {
  const [rows] = await pool.query(
    'SELECT * FROM properties WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
    { id: propertyId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Bien introuvable');
  if (scopeAgentId != null && Number(rows[0].agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Bien introuvable');
  }
  return rows[0];
}

/** `scopeAgentId` (étape 14) : un agent restreint n'accède qu'aux relevés de ses propres Biens. */
async function loadBatch(tenantId, batchId, scopeAgentId = null) {
  const [rows] = await pool.query(
    `SELECT b.*, p.code AS property_code, p.agent_id AS property_agent_id,
            u.first_name AS recorder_first_name, u.last_name AS recorder_last_name, u.role AS recorder_role
     FROM utility_reading_batches b
     JOIN properties p ON p.id = b.property_id
     LEFT JOIN users u ON u.id = b.recorded_by
     WHERE b.id = :id AND b.tenant_id = :tenantId LIMIT 1`,
    { id: batchId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Relevé introuvable');
  if (scopeAgentId != null && Number(rows[0].property_agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Relevé introuvable');
  }
  return rows[0];
}

/** Lignes du relevé + contexte (unité, bail actif, locataire, index précédent). */
async function loadRows(tenantId, batch) {
  const [rows] = await pool.query(
    `SELECT r.*, pu.code AS unit_code, pu.designation, pu.designation_custom,
            pu.${batch.utility_type}_meter_number AS meter_number,
            al.id AS active_lease_id, al.status AS active_lease_status,
            ar.first_name AS renter_first_name, ar.last_name AS renter_last_name,
            ch.status AS charge_status,
            (SELECT ur.reading_end
               FROM utility_readings ur
               JOIN utility_reading_batches ub ON ub.id = ur.batch_id
               WHERE ur.unit_id = r.unit_id AND ub.property_id = :propertyId
                 AND ub.utility_type = :utilityType AND ub.status = 'valide' AND ub.id <> :batchId
               ORDER BY ub.period_end DESC, ub.id DESC LIMIT 1) AS previous_reading
     FROM utility_readings r
     JOIN property_units pu ON pu.id = r.unit_id
     LEFT JOIN leases al ON al.unit_id = r.unit_id AND al.tenant_id = :tenantId AND al.status = 'active'
     LEFT JOIN renters ar ON ar.id = al.renter_id
     LEFT JOIN utility_charges ch ON ch.id = r.charge_id
     WHERE r.batch_id = :batchId AND r.tenant_id = :tenantId
     ORDER BY pu.code`,
    { tenantId, batchId: batch.id, propertyId: batch.property_id, utilityType: batch.utility_type },
  );
  return rows;
}

function computeTotals(batch, rows) {
  const subConsumption = rows.reduce((s, r) => s + (r.reading_end - r.reading_start), 0);
  const subAmount = rows.reduce((s, r) => s + Number(r.amount), 0);
  const hasMain = batch.main_reading_start != null && batch.main_reading_end != null;
  const mainConsumption = hasMain ? batch.main_reading_end - batch.main_reading_start : null;
  const mainAmount = batch.main_invoice_amount != null ? Number(batch.main_invoice_amount) : null;
  const differenceConsumption = mainConsumption != null ? mainConsumption - subConsumption : null;
  const differenceAmount = mainAmount != null ? mainAmount - subAmount : null;
  const differencePct =
    mainConsumption && mainConsumption > 0 && differenceConsumption != null
      ? differenceConsumption / mainConsumption
      : null;
  let alert = 'none';
  if (differenceConsumption != null && (differenceConsumption < 0 || (differenceAmount != null && differenceAmount < 0))) {
    alert = 'negative';
  } else if (differencePct != null && differencePct > DIFFERENCE_ALERT_PCT) {
    alert = 'high';
  }
  return { subConsumption, subAmount, mainConsumption, mainAmount, differenceConsumption, differenceAmount, differencePct, alert };
}

function toPublicBatch(batch, rows) {
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
      charge: r.charge_id ? { id: r.charge_id, status: r.charge_status } : null,
    })),
    totals: computeTotals(batch, rows),
  };
}

/** Réglage de répartition de l'écart pour ce Bien/fluide (colonne dynamique — `utility_type` est un ENUM, jamais une entrée utilisateur libre). */
async function loadLossAllocation(propertyId, utilityType) {
  const [[row]] = await pool.query(
    `SELECT ${utilityType}_loss_allocation AS loss_allocation FROM properties WHERE id = ?`,
    [propertyId],
  );
  return row?.loss_allocation ?? 'proprietaire';
}

async function respondBatch(res, tenantId, batchId, scopeAgentId = null) {
  const batch = await loadBatch(tenantId, batchId, scopeAgentId);
  batch.loss_allocation = await loadLossAllocation(batch.property_id, batch.utility_type);
  const rows = await loadRows(tenantId, batch);
  res.json(toPublicBatch(batch, rows));
}

// ── Configuration du sous-comptage d'un Bien ─────────────────────────────

// PATCH /api/properties/:propertyId/utility-config
router.patch('/properties/:propertyId/utility-config', async (req, res, next) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId)) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = utilityConfigSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const d = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadProperty(req.user.tenantId, propertyId, scopeAgentId);

    const map = {
      sonebSubmetered: 'soneb_submetered',
      sbeeSubmetered: 'sbee_submetered',
      sonebUnitPrice: 'soneb_unit_price',
      sbeeUnitPrice: 'sbee_unit_price',
      sonebMainMeterNumber: 'soneb_main_meter_number',
      sbeeMainMeterNumber: 'sbee_main_meter_number',
      sonebAccountNumber: 'soneb_account_number',
      sbeeAccountNumber: 'sbee_account_number',
      sonebLossAllocation: 'soneb_loss_allocation',
      sbeeLossAllocation: 'sbee_loss_allocation',
    };
    const fields = [];
    const params = { id: propertyId };
    for (const [key, col] of Object.entries(map)) {
      if (d[key] !== undefined) {
        fields.push(`${col} = :${key}`);
        params[key] = typeof d[key] === 'boolean' ? (d[key] ? 1 : 0) : d[key];
      }
    }
    // Cohérence : sous-comptage activé ⇒ un tarif est requis.
    for (const u of ['soneb', 'sbee']) {
      const sub = d[`${u}Submetered`];
      if (sub === true) {
        const price = d[`${u}UnitPrice`];
        if (price == null) {
          const [[cur]] = await pool.query(`SELECT ${u}_unit_price AS p FROM properties WHERE id = :id`, { id: propertyId });
          if (cur.p == null) return next(new ApiError(400, `Renseignez le prix unitaire ${u.toUpperCase()} pour activer le sous-comptage.`));
        }
      }
    }
    if (fields.length > 0) {
      await pool.query(`UPDATE properties SET ${fields.join(', ')} WHERE id = :id`, params);
    }
    const [rows] = await pool.query('SELECT * FROM properties WHERE id = :id LIMIT 1', { id: propertyId });
    const p = rows[0];
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
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId)) return next(new ApiError(400, 'Identifiant invalide'));
  const utilityType = typeof req.query.utilityType === 'string' ? req.query.utilityType : null;
  if (utilityType && !UTILITY_TYPE_KEYS.includes(utilityType)) return next(new ApiError(400, 'Fluide invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadProperty(req.user.tenantId, propertyId, scopeAgentId);
    const [rows] = await pool.query(
      `SELECT b.*,
              COALESCE(SUM(r.reading_end - r.reading_start), 0) AS sub_consumption,
              COALESCE(SUM(r.amount), 0) AS sub_amount,
              COUNT(r.id) AS row_count
       FROM utility_reading_batches b
       LEFT JOIN utility_readings r ON r.batch_id = b.id
       WHERE b.property_id = :propertyId AND b.tenant_id = :tenantId
         ${utilityType ? 'AND b.utility_type = :utilityType' : ''}
       GROUP BY b.id
       ORDER BY b.period_start DESC, b.id DESC`,
      { propertyId, tenantId: req.user.tenantId, utilityType },
    );
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
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId)) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = createBatchSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const { utilityType, periodStart, periodEnd } = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const property = await loadProperty(req.user.tenantId, propertyId, scopeAgentId);
    if (!property[`${utilityType}_submetered`]) {
      throw new ApiError(400, `Le sous-comptage ${utilityType.toUpperCase()} n'est pas activé pour ce bien.`);
    }
    const unitPrice = property[`${utilityType}_unit_price`];
    if (unitPrice == null) throw new ApiError(400, `Aucun prix unitaire ${utilityType.toUpperCase()} défini pour ce bien.`);

    const [dup] = await conn.query(
      `SELECT id FROM utility_reading_batches
       WHERE tenant_id = :tenantId AND property_id = :propertyId AND utility_type = :utilityType AND period_start = :periodStart
       LIMIT 1`,
      { tenantId: req.user.tenantId, propertyId, utilityType, periodStart },
    );
    if (dup.length > 0) throw new ApiError(409, 'Un relevé existe déjà pour ce bien, ce fluide et cette période.');

    const [units] = await conn.query(
      `SELECT id FROM property_units
       WHERE property_id = :propertyId AND tenant_id = :tenantId
         AND ${utilityType}_meter_number IS NOT NULL AND ${utilityType}_meter_number <> ''
       ORDER BY code`,
      { propertyId, tenantId: req.user.tenantId },
    );
    if (units.length === 0) {
      throw new ApiError(400, `Aucune unité n'a de numéro de compteur ${utilityType.toUpperCase()} — renseignez-les sur les unités d'abord.`);
    }

    await conn.beginTransaction();
    const [batchRes] = await conn.query(
      `INSERT INTO utility_reading_batches (tenant_id, property_id, utility_type, period_start, period_end, unit_price, recorded_by)
       VALUES (:tenantId, :propertyId, :utilityType, :periodStart, :periodEnd, :unitPrice, :recordedBy)`,
      { tenantId: req.user.tenantId, propertyId, utilityType, periodStart, periodEnd, unitPrice, recordedBy: req.user.id },
    );
    const batchId = batchRes.insertId;

    for (const u of units) {
      const [[prev]] = await conn.query(
        `SELECT ur.reading_end
         FROM utility_readings ur
         JOIN utility_reading_batches ub ON ub.id = ur.batch_id
         WHERE ur.unit_id = :unitId AND ub.property_id = :propertyId AND ub.utility_type = :utilityType AND ub.status = 'valide'
         ORDER BY ub.period_end DESC LIMIT 1`,
        { unitId: u.id, propertyId, utilityType },
      );
      const start = prev ? prev.reading_end : 0;
      await conn.query(
        `INSERT INTO utility_readings (tenant_id, batch_id, unit_id, reading_start, reading_end, amount)
         VALUES (:tenantId, :batchId, :unitId, :start, :start, 0)`,
        { tenantId: req.user.tenantId, batchId, unitId: u.id, start },
      );
    }
    await conn.commit();
    logger.info('Relevé de compteurs créé', { tenantId: req.user.tenantId, batchId, propertyId, utilityType, units: units.length });
    await respondBatch(res, req.user.tenantId, batchId);
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/utility-batches/:id
router.get('/utility-batches/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await respondBatch(res, req.user.tenantId, id, scopeAgentId);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/utility-batches/:id  { mainReadingStart?, mainReadingEnd?, mainInvoiceAmount?, readings:[{unitId,readingStart,readingEnd}] }
router.patch('/utility-batches/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = saveBatchSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const d = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const batch = await loadBatch(req.user.tenantId, id, scopeAgentId);
    if (batch.status !== 'brouillon') throw new ApiError(409, 'Ce relevé est validé. Rouvrez-le pour le modifier.');

    const [existing] = await conn.query('SELECT unit_id FROM utility_readings WHERE batch_id = :id', { id });
    const known = new Set(existing.map((r) => r.unit_id));
    for (const row of d.readings) {
      if (!known.has(row.unitId)) throw new ApiError(400, `Unité ${row.unitId} absente de ce relevé.`);
    }

    await conn.beginTransaction();

    const mainFields = [];
    const mainParams = { id };
    for (const [key, col] of [
      ['mainReadingStart', 'main_reading_start'],
      ['mainReadingEnd', 'main_reading_end'],
      ['mainInvoiceAmount', 'main_invoice_amount'],
    ]) {
      if (d[key] !== undefined) {
        mainFields.push(`${col} = :${key}`);
        mainParams[key] = d[key];
      }
    }
    if (mainFields.length > 0) {
      await conn.query(`UPDATE utility_reading_batches SET ${mainFields.join(', ')} WHERE id = :id`, mainParams);
    }

    const unitPrice = Number(batch.unit_price);
    for (const row of d.readings) {
      const amount = Math.round((row.readingEnd - row.readingStart) * unitPrice);
      await conn.query(
        `UPDATE utility_readings SET reading_start = :start, reading_end = :end, amount = :amount
         WHERE batch_id = :batchId AND unit_id = :unitId`,
        { start: row.readingStart, end: row.readingEnd, amount, batchId: id, unitId: row.unitId },
      );
    }
    await conn.commit();
    await respondBatch(res, req.user.tenantId, id);
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// POST /api/utility-batches/:id/validate — génère les factures, verrouille.
router.post('/utility-batches/:id/validate', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const batch = await loadBatch(req.user.tenantId, id, scopeAgentId);
    if (batch.status !== 'brouillon') throw new ApiError(409, 'Ce relevé est déjà validé.');
    if (batch.main_reading_start == null || batch.main_reading_end == null || batch.main_invoice_amount == null) {
      throw new ApiError(400, 'Renseignez l\'index et le montant de la facture du compteur principal avant de valider.');
    }
    if (batch.main_reading_end < batch.main_reading_start) {
      throw new ApiError(400, 'Compteur principal : l\'index de fin doit être supérieur ou égal à l\'index de début.');
    }
    await assertPeriodOpen(req.user.tenantId, isoDate(batch.period_end));

    const [rows] = await conn.query(
      `SELECT r.id, r.unit_id, r.reading_start, r.reading_end, r.amount,
              al.id AS active_lease_id
       FROM utility_readings r
       LEFT JOIN leases al ON al.unit_id = r.unit_id AND al.tenant_id = :tenantId AND al.status = 'active'
       WHERE r.batch_id = :id`,
      { id, tenantId: req.user.tenantId },
    );
    if (rows.length === 0) throw new ApiError(400, 'Ce relevé ne contient aucune ligne.');
    for (const r of rows) {
      if (r.reading_end < r.reading_start) {
        throw new ApiError(400, `Unité ${r.unit_id} : index de fin inférieur à l'index de début.`);
      }
    }

    // Répartition de l'écart (étape 23) : seulement si activée sur ce Bien
    // pour ce fluide, et seulement un écart RÉEL et positif (jamais la
    // « négative » — décompteurs > compteur principal — qui signale une
    // anomalie de relevé, pas une perte). Répartie au prorata des seules
    // unités effectivement facturables (bail actif) : une unité vacante ne
    // peut recevoir aucune part, la sienne retombe donc sur les locataires
    // en place, comme sa propre consommation mesurée mais non facturée.
    const lossAllocation = await loadLossAllocation(batch.property_id, batch.utility_type);
    const totals = computeTotals(batch, rows);
    const billableRows = rows.filter((r) => r.active_lease_id && Number(r.amount) > 0);
    const billableSubAmount = billableRows.reduce((s, r) => s + Number(r.amount), 0);
    const applyLoss =
      lossAllocation === 'prorata' &&
      totals.differenceAmount != null &&
      totals.differenceAmount > 0 &&
      billableSubAmount > 0;

    await conn.beginTransaction();
    let generated = 0;
    for (const r of rows) {
      if (r.active_lease_id && Number(r.amount) > 0) {
        const lossShare = applyLoss
          ? Math.round(totals.differenceAmount * (Number(r.amount) / billableSubAmount))
          : 0;
        const amount = Number(r.amount) + lossShare;
        const [chRes] = await conn.query(
          `INSERT INTO utility_charges
             (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, loss_share_amount, billed_at, status, recorded_by)
           VALUES (:tenantId, :leaseId, :utilityType, :periodStart, :periodEnd, :readingStart, :readingEnd, :unitPrice, :amount, :lossShareAmount, CURDATE(), 'impayee', :recordedBy)`,
          {
            tenantId: req.user.tenantId,
            leaseId: r.active_lease_id,
            utilityType: batch.utility_type,
            periodStart: isoDate(batch.period_start),
            periodEnd: isoDate(batch.period_end),
            readingStart: r.reading_start,
            readingEnd: r.reading_end,
            unitPrice: Number(batch.unit_price),
            amount,
            lossShareAmount: lossShare,
            recordedBy: req.user.id,
          },
        );
        await conn.query('UPDATE utility_readings SET charge_id = :chargeId, lease_id = :leaseId WHERE id = :id', {
          chargeId: chRes.insertId,
          leaseId: r.active_lease_id,
          id: r.id,
        });
        generated += 1;
      } else {
        await conn.query('UPDATE utility_readings SET lease_id = :leaseId WHERE id = :id', {
          leaseId: r.active_lease_id || null,
          id: r.id,
        });
      }
    }
    await conn.query("UPDATE utility_reading_batches SET status = 'valide', validated_at = NOW() WHERE id = :id", { id });
    await conn.commit();
    logger.info('Relevé de compteurs validé', {
      tenantId: req.user.tenantId,
      batchId: id,
      chargesGenerated: generated,
      lossAllocation,
      lossDistributed: applyLoss ? totals.differenceAmount : 0,
      by: req.user.id,
    });
    await respondBatch(res, req.user.tenantId, id);
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// POST /api/utility-batches/:id/reopen — supprime les factures NON PAYÉES, repasse en brouillon.
router.post('/utility-batches/:id/reopen', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const batch = await loadBatch(req.user.tenantId, id, scopeAgentId);
    if (batch.status !== 'valide') throw new ApiError(409, 'Ce relevé n\'est pas validé.');
    if (await isPeriodClosed(req.user.tenantId, isoDate(batch.period_end))) {
      throw new ApiError(409, 'Le mois comptable est clôturé — impossible de rouvrir ce relevé.');
    }

    const [linked] = await conn.query(
      `SELECT ch.id, ch.status
       FROM utility_readings r JOIN utility_charges ch ON ch.id = r.charge_id
       WHERE r.batch_id = :id`,
      { id },
    );
    if (linked.some((c) => c.status === 'payee')) {
      throw new ApiError(409, 'Une facture générée par ce relevé est déjà payée — impossible de rouvrir.');
    }

    await conn.beginTransaction();
    if (linked.length > 0) {
      await conn.query('DELETE FROM utility_charges WHERE id IN (?)', [linked.map((c) => c.id)]);
      await conn.query('UPDATE utility_readings SET charge_id = NULL WHERE batch_id = :id', { id });
    }
    await conn.query("UPDATE utility_reading_batches SET status = 'brouillon', validated_at = NULL WHERE id = :id", { id });
    await conn.commit();
    logger.info('Relevé de compteurs rouvert', { tenantId: req.user.tenantId, batchId: id, chargesDeleted: linked.length, by: req.user.id });
    await respondBatch(res, req.user.tenantId, id);
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// DELETE /api/utility-batches/:id — uniquement un brouillon.
router.delete('/utility-batches/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const batch = await loadBatch(req.user.tenantId, id, scopeAgentId);
    if (batch.status !== 'brouillon') throw new ApiError(409, 'Un relevé validé ne peut pas être supprimé — rouvrez-le d\'abord.');
    await pool.query('DELETE FROM utility_reading_batches WHERE id = :id AND tenant_id = :tenantId', {
      id,
      tenantId: req.user.tenantId,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
