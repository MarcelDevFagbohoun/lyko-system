'use strict';

/**
 * Étape 30 — « Le point des charges » : pour chaque relevé SONEB/SBEE validé,
 * confronte ce que le propriétaire a payé à la facture mère à ce que le
 * cabinet a réellement encaissé chez les locataires.
 *
 *   facture mère payée (A)  — saisie sur le relevé (mémo, pas un mouvement du cabinet)
 *   facturé aux locataires (B) — Σ des factures générées à la validation (écart réparti inclus)
 *   encaissé (C)            — Σ des règlements reçus sur ces factures
 *
 *   reste à la charge du propriétaire = A − C, qui se décompose en
 *     · consommation non refacturée = A − B  (parties communes, logements vacants,
 *       pertes de ligne — jamais refacturée quand l'écart est « à la charge du
 *       propriétaire »)
 *     · impayés des locataires      = B − C  (encore récupérables)
 *
 * Les factures supprimées logiquement (`deleted_at`) sortent de B et de C,
 * comme dans tous les autres totaux de l'application.
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { getChargeAccount, listRemittances } = require('./utilityRemittance');

const num = (v) => (v == null ? null : Number(v));
const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Statut d'un relevé validé, dans l'ordre de priorité de l'action à mener :
 *  - paiement_non_renseigne : la facture mère n'a pas (encore) été déclarée payée ;
 *  - a_recouvrer            : des locataires doivent encore de l'argent ;
 *  - a_charge_proprietaire  : tout ce qui a été facturé est encaissé mais la
 *                              facture mère payée dépasse ce total (perte réelle) ;
 *  - solde                  : le propriétaire est intégralement couvert.
 */
function computeBatchPoint(row) {
  const mainInvoice = num(row.main_invoice_amount);
  const mainPaid = num(row.main_paid_amount);
  const billed = Number(row.billed);
  const collected = Number(row.collected);
  const tenantUnpaid = billed - collected;

  const paid = mainPaid != null;
  const gap = paid ? mainPaid - collected : null;
  const nonRebilled = paid ? mainPaid - billed : null;

  let status;
  if (!paid) status = 'paiement_non_renseigne';
  else if (tenantUnpaid > 0) status = 'a_recouvrer';
  else if (gap > 0) status = 'a_charge_proprietaire';
  else status = 'solde';

  return {
    batchId: row.id,
    propertyId: row.property_id,
    propertyCode: row.property_code,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    utilityType: row.utility_type,
    periodStart: isoDate(row.period_start),
    periodEnd: isoDate(row.period_end),
    mainInvoice,
    mainPaid,
    mainPaidAt: isoDate(row.main_paid_at),
    chargesCount: Number(row.charges_count),
    unpaidChargesCount: Number(row.unpaid_charges_count),
    billed,
    collected,
    tenantUnpaid,
    gap,
    nonRebilled,
    status,
  };
}

/** Totaux d'un ensemble de relevés : les colonnes « décomposition » ne portent que sur les relevés dont la facture mère est déclarée payée. */
function sumPoints(points) {
  const paid = points.filter((p) => p.mainPaid != null);
  const sum = (arr, key) => arr.reduce((s, p) => s + p[key], 0);
  const mainPaidTotal = sum(paid, 'mainPaid');
  const billedOnPaid = sum(paid, 'billed');
  const collectedOnPaid = sum(paid, 'collected');
  const pending = points.filter((p) => p.mainPaid == null);
  return {
    batchCount: points.length,
    mainInvoiceTotal: points.reduce((s, p) => s + (p.mainInvoice ?? 0), 0),
    billedTotal: sum(points, 'billed'),
    collectedTotal: sum(points, 'collected'),
    tenantUnpaidTotal: sum(points, 'tenantUnpaid'),
    mainPaidTotal,
    gapTotal: mainPaidTotal - collectedOnPaid,
    nonRebilledTotal: mainPaidTotal - billedOnPaid,
    tenantUnpaidOnPaidTotal: billedOnPaid - collectedOnPaid,
    pendingPaymentCount: pending.length,
    pendingInvoiceAmount: pending.reduce((s, p) => s + (p.mainInvoice ?? 0), 0),
  };
}

async function loadBatchPoints(tenantId, { batchId, ownerId, propertyId, fromMonth, toMonth, scopeAgentId } = {}) {
  const where = ["b.tenant_id = :tenantId", "b.status = 'valide'"];
  const params = { tenantId };
  if (batchId != null) {
    where.push('b.id = :batchId');
    params.batchId = batchId;
  }
  if (ownerId != null) {
    where.push('p.owner_id = :ownerId');
    params.ownerId = ownerId;
  }
  if (propertyId != null) {
    where.push('b.property_id = :propertyId');
    params.propertyId = propertyId;
  }
  if (scopeAgentId != null) {
    where.push('p.agent_id = :scopeAgentId');
    params.scopeAgentId = scopeAgentId;
  }
  if (fromMonth) {
    where.push('b.period_start >= :fromDate');
    params.fromDate = `${fromMonth}-01`;
  }
  if (toMonth) {
    where.push('b.period_start < DATE_ADD(:toFirst, INTERVAL 1 MONTH)');
    params.toFirst = `${toMonth}-01`;
  }

  const [rows] = await pool.query(
    `SELECT b.id, b.property_id, b.utility_type, b.period_start, b.period_end,
            b.main_invoice_amount, b.main_paid_amount, b.main_paid_at,
            p.code AS property_code, p.owner_id, o.name AS owner_name,
            COALESCE(agg.billed, 0) AS billed,
            COALESCE(agg.collected, 0) AS collected,
            COALESCE(agg.charges_count, 0) AS charges_count,
            COALESCE(agg.unpaid_charges_count, 0) AS unpaid_charges_count
     FROM utility_reading_batches b
     JOIN properties p ON p.id = b.property_id
     JOIN owners o ON o.id = p.owner_id
     LEFT JOIN (
       SELECT r.batch_id,
              SUM(ch.amount) AS billed,
              SUM(COALESCE(pay.paid, 0)) AS collected,
              COUNT(ch.id) AS charges_count,
              SUM(CASE WHEN ch.status <> 'payee' THEN 1 ELSE 0 END) AS unpaid_charges_count
       FROM utility_readings r
       JOIN utility_charges ch ON ch.id = r.charge_id AND ch.deleted_at IS NULL
       LEFT JOIN (SELECT charge_id, SUM(amount) AS paid FROM utility_payments GROUP BY charge_id) pay
              ON pay.charge_id = ch.id
       GROUP BY r.batch_id
     ) agg ON agg.batch_id = b.id
     WHERE ${where.join(' AND ')}
     ORDER BY o.name, p.code, b.period_start DESC, b.utility_type`,
    params,
  );
  return rows.map(computeBatchPoint);
}

/** Point d'un seul relevé (null s'il n'est pas validé ou hors périmètre). */
async function getBatchPoint(tenantId, batchId, scopeAgentId = null) {
  const points = await loadBatchPoints(tenantId, { batchId, scopeAgentId });
  return points[0] ?? null;
}

/** Point de tous les propriétaires (ou d'un seul) sur une plage de mois, groupé par propriétaire. */
async function getUtilityPoint(tenantId, filters = {}) {
  const points = await loadBatchPoints(tenantId, filters);
  const byOwner = new Map();
  for (const p of points) {
    if (!byOwner.has(p.ownerId)) byOwner.set(p.ownerId, { ownerId: p.ownerId, ownerName: p.ownerName, batches: [] });
    byOwner.get(p.ownerId).batches.push(p);
  }
  const owners = [...byOwner.values()].map((o) => ({ ...o, totals: sumPoints(o.batches) }));
  return { owners, totals: sumPoints(points) };
}

/**
 * Fenêtre de mois AAAA-MM (bornes incluses) — défaut : les 6 derniers mois,
 * le mois courant compris. Partagée par l'écran, les PDF et le portail pour
 * ne jamais interpréter les paramètres `from`/`to` de deux façons.
 */
function resolveMonthWindow(fromQuery, toQuery, now = new Date()) {
  const currentMonth = now.toISOString().slice(0, 7);
  const toMonth = typeof toQuery === 'string' && toQuery ? toQuery : currentMonth;
  let fromMonth = typeof fromQuery === 'string' && fromQuery ? fromQuery : null;
  if (!MONTH_RE.test(toMonth) || (fromMonth && !MONTH_RE.test(fromMonth))) {
    throw new ApiError(400, 'Période invalide (AAAA-MM)');
  }
  if (!fromMonth) {
    const [y, m] = toMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 - 5, 1));
    fromMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (fromMonth > toMonth) throw new ApiError(400, 'Le mois de début doit précéder le mois de fin.');
  return { fromMonth, toMonth };
}

function lastDayOfMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Carnet des entrées : chaque règlement de charge reçu d'un locataire pour
 * les Biens d'un propriétaire, du plus ancien au plus récent. La fenêtre porte
 * sur le mois de début de la PÉRIODE FACTURÉE (comme le point par relevé), pas
 * sur la date du règlement — un règlement tardif reste rattaché à sa facture.
 * `batchId` nul = facture individuelle saisie hors relevé de compteurs.
 */
async function getUtilityEntries(tenantId, { ownerId, fromMonth, toMonth, scopeAgentId = null }) {
  const params = { tenantId, ownerId, fromDate: `${fromMonth}-01`, toFirst: `${toMonth}-01` };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = 'AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT up.id, up.paid_at, up.amount, up.payment_method,
            uc.id AS charge_id, uc.utility_type, uc.period_start, uc.period_end,
            p.id AS property_id, p.code AS property_code, u.code AS unit_code,
            r.first_name AS renter_first_name, r.last_name AS renter_last_name,
            ur.batch_id
     FROM utility_payments up
     JOIN utility_charges uc ON uc.id = up.charge_id AND uc.deleted_at IS NULL
     JOIN leases l ON l.id = uc.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     JOIN renters r ON r.id = l.renter_id
     LEFT JOIN utility_readings ur ON ur.charge_id = uc.id
     WHERE up.tenant_id = :tenantId AND p.owner_id = :ownerId ${scopeClause}
       AND uc.period_start >= :fromDate AND uc.period_start < DATE_ADD(:toFirst, INTERVAL 1 MONTH)
     ORDER BY up.paid_at, up.id`,
    params,
  );
  const items = rows.map((r) => ({
    paymentId: r.id,
    paidAt: isoDate(r.paid_at),
    amount: Number(r.amount),
    paymentMethod: r.payment_method,
    chargeId: r.charge_id,
    batchId: r.batch_id ?? null,
    utilityType: r.utility_type,
    periodStart: isoDate(r.period_start),
    periodEnd: isoDate(r.period_end),
    propertyId: r.property_id,
    propertyCode: r.property_code,
    unitCode: r.unit_code,
    renterName: `${r.renter_first_name} ${r.renter_last_name}`,
  }));
  return {
    items,
    total: items.reduce((s, e) => s + e.amount, 0),
    outsideBatchesTotal: items.filter((e) => e.batchId == null).reduce((s, e) => s + e.amount, 0),
  };
}

/**
 * Carnet complet d'un propriétaire pour une fenêtre de mois : le point par
 * relevé, les entrées, les reversements de la fenêtre et — hors périmètre
 * agent restreint — son solde à reverser À CE JOUR (jamais borné à la
 * fenêtre : c'est un solde cumulé, comme le séquestre des loyers).
 */
async function getOwnerCarnet(tenantId, ownerId, { fromMonth, toMonth, scopeAgentId = null }) {
  const point = await getUtilityPoint(tenantId, { ownerId, fromMonth, toMonth, scopeAgentId });
  const entries = await getUtilityEntries(tenantId, { ownerId, fromMonth, toMonth, scopeAgentId });
  const remittances = await listRemittances(pool, tenantId, ownerId, {
    fromDate: `${fromMonth}-01`,
    toDate: lastDayOfMonth(toMonth),
  });
  const account = scopeAgentId == null ? await getChargeAccount(pool, tenantId, ownerId) : null;
  return {
    from: fromMonth,
    to: toMonth,
    batches: point.owners[0]?.batches ?? [],
    totals: point.totals,
    entries,
    remittances,
    remittedInWindow: remittances.reduce((s, r) => s + r.amount, 0),
    account,
  };
}

module.exports = {
  MONTH_RE,
  computeBatchPoint,
  sumPoints,
  getBatchPoint,
  getUtilityPoint,
  resolveMonthWindow,
  getUtilityEntries,
  getOwnerCarnet,
};
