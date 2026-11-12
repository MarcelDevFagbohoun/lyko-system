'use strict';

/**
 * Routage des impayés à l'entrée par type (demande utilisateur, 2026-11-12) : « si c'est un impayé
 * de loyer ça doit se figurer dans les relances du mois, si c'est SBEE [ou SONEB] dans les charges,
 * et autres [poubelle/autre] doit être dans les alertes ». Jusqu'ici, TOUT type d'impayé à l'entrée
 * gonflait indifféremment le montant affiché dans le Centre de relance (loyer) — ce module route
 * chaque poste restant vers sa bonne destination :
 *  - loyer              → Centre de relance (rentTracking.js, `listPortfolioArrears`)
 *  - sbee / soneb       → carte « Impayés à l'entrée à régler » de la page Charges
 *  - poubelle / autre   → carte « Alertes du suivi des charges » de la page Charges
 *
 * Module séparé, sans dépendance vers rentTracking.js : `rentTracking.js`, `accountingRegisters.js`
 * et `utilityAlerts.js` en ont tous besoin, et rentTracking.js est lui-même requis par
 * leasePayments.js — le mettre là aurait créé une dépendance circulaire.
 */

const { pool } = require('../config/db');

const RELANCES_TYPES = ['loyer'];
const CHARGES_TYPES = ['sbee', 'soneb'];
const ALERTES_TYPES = ['poubelle', 'autre'];

/**
 * Les baux, parmi `leaseIds`, qui ont AU MOINS UN poste détaillé (`lease_opening_debt_items`),
 * quel que soit son type — sert à distinguer une dette héritée saisie en vrac (avant la
 * ventilation par type, migration 151 : traitée partout comme « loyer », comportement historique
 * préservé) d'une dette avec détail par poste (où seul le sous-total « loyer » doit compter pour
 * les relances, le reste étant désormais affiché ailleurs).
 */
async function leaseIdsWithOpeningDebtItems(leaseIds) {
  if (!leaseIds.length) return new Set();
  const [rows] = await pool.query(
    'SELECT DISTINCT lease_id FROM lease_opening_debt_items WHERE lease_id IN (:leaseIds)',
    { leaseIds },
  );
  return new Set(rows.map((r) => r.lease_id));
}

/**
 * Reste à régler, par bail, pour les postes d'un groupe de types donné parmi `leaseIds`.
 * `asOfDate` ('AAAA-MM-JJ' optionnel) : reconstruction à une date passée — seuls les règlements de
 * poste déjà faits à cette date-là comptent (via `lease_opening_debt_payments.paid_at`, seule date
 * portée par le règlement ; `lease_opening_debt_item_payments` ne fait que lier le poste à lui),
 * même principe que `paidBy()` dans `listPortfolioArrears` ci-dessous.
 */
async function getOpeningDebtRemainingByLease(leaseIds, debtTypes, asOfDate = null) {
  const byLease = new Map();
  if (!leaseIds.length) return byLease;
  const params = { leaseIds, debtTypes };
  let paidDateClause = '';
  if (asOfDate) {
    paidDateClause = 'AND lop.paid_at <= :asOfDate';
    params.asOfDate = asOfDate;
  }
  const [rows] = await pool.query(
    `SELECT i.lease_id, i.amount,
            COALESCE((
              SELECT SUM(p.amount) FROM lease_opening_debt_item_payments p
              JOIN lease_opening_debt_payments lop ON lop.id = p.lease_payment_id
              WHERE p.item_id = i.id ${paidDateClause}
            ), 0) AS paid
     FROM lease_opening_debt_items i
     WHERE i.lease_id IN (:leaseIds) AND i.debt_type IN (:debtTypes)`,
    params,
  );
  for (const r of rows) {
    const remaining = Math.max(0, Number(r.amount) - Number(r.paid));
    byLease.set(r.lease_id, (byLease.get(r.lease_id) || 0) + remaining);
  }
  return byLease;
}

/**
 * Détail poste par poste (pas seulement le total) restant à régler pour un groupe de types, sur
 * les baux actifs du portefeuille (portée agence appliquée) — alimente la carte Charges et les
 * alertes.
 */
async function listOpeningDebtItemsRemaining(tenantId, scopeAgentId, debtTypes) {
  const params = { tenantId, debtTypes };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = 'AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT i.id AS item_id, i.lease_id, i.debt_type, i.period_month, i.label, i.amount,
            COALESCE((SELECT SUM(ip.amount) FROM lease_opening_debt_item_payments ip WHERE ip.item_id = i.id), 0) AS paid,
            l.renter_id, r.first_name, r.last_name, r.phone,
            u.code AS unit_code, p.code AS property_code
     FROM lease_opening_debt_items i
     JOIN leases l ON l.id = i.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE i.tenant_id = :tenantId AND i.debt_type IN (:debtTypes) AND l.status = 'active' ${scopeClause}
     ORDER BY i.period_month DESC, i.id DESC`,
    params,
  );
  return rows
    .map((r) => ({
      itemId: r.item_id,
      leaseId: r.lease_id,
      debtType: r.debt_type,
      periodMonth: r.period_month,
      label: r.label,
      amount: Number(r.amount),
      paid: Number(r.paid),
      remaining: Math.max(0, Number(r.amount) - Number(r.paid)),
      renterId: r.renter_id,
      renterName: `${r.first_name} ${r.last_name}`,
      phone: r.phone,
      unitCode: r.unit_code,
      propertyCode: r.property_code,
    }))
    .filter((r) => r.remaining > 0);
}

module.exports = {
  RELANCES_TYPES,
  CHARGES_TYPES,
  ALERTES_TYPES,
  leaseIdsWithOpeningDebtItems,
  getOpeningDebtRemainingByLease,
  listOpeningDebtItemsRemaining,
};
