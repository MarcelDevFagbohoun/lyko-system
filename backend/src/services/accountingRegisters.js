'use strict';

/**
 * Lectures SQL des registres de la page Comptabilité : charges SONEB/SBEE impayées (centre de relance),
 * paiements de loyer et versements aux propriétaires d'une période. Lignes brutes — la mise en forme
 * publique reste dans `routes/accounting.js`. Déplacé à l'identique.
 */

const { pool } = require('../config/db');

/** Factures SONEB/SBEE impayées ou partiellement réglées (une ligne par facture), plus anciennes d'abord. */
async function listUtilityArrearsRows(tenantId, scopeAgentId) {
  const params = { tenantId };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT uc.id AS charge_id, uc.amount, uc.utility_type, uc.billed_at, uc.status,
            COALESCE(pt.paid_total, 0) AS paid_total,
            l.id AS lease_id,
            r.id AS renter_id, r.first_name, r.last_name, r.phone,
            u.code AS unit_code, p.code AS property_code,
            (SELECT MAX(sent_at) FROM relance_log WHERE entity_type = 'charge' AND entity_id = uc.id) AS last_relance_at
     FROM utility_charges uc
     LEFT JOIN (SELECT charge_id, SUM(amount) AS paid_total FROM utility_payments GROUP BY charge_id) pt
       ON pt.charge_id = uc.id
     JOIN leases l ON l.id = uc.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NULL AND uc.status <> 'payee' ${scopeClause}
     ORDER BY uc.billed_at ASC`,
    params,
  );
  return rows;
}

/** Paiements de loyer de la période (plus récents d'abord). */
async function listRentPaymentRows(tenantId, from, to) {
  const [rows] = await pool.query(
    `SELECT rp.*, r.id AS renter_id, r.first_name AS renter_first_name, r.last_name AS renter_last_name,
            u.code AS unit_code, ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name, ru.role AS recorder_role
     FROM rent_payments rp
     JOIN leases l ON l.id = rp.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     LEFT JOIN users ru ON ru.id = rp.recorded_by
     WHERE rp.tenant_id = :tenantId AND rp.paid_at BETWEEN :from AND :to AND rp.deleted_at IS NULL
     ORDER BY rp.paid_at DESC, rp.id DESC`,
    { tenantId, from, to },
  );
  return rows;
}

/**
 * Règlements des impayés à l'entrée de la période (plus récents d'abord) — demande utilisateur,
 * 2026-11-12 : « il faut que tous ces changements soient dans les opérations trésorerie ». Couvre
 * aussi bien un règlement global (ancien comportement, `lease_opening_debt_payments` seule) qu'un
 * règlement d'UN poste du détail par type + mois (migration 151) : dans ce cas, `lease_opening_debt_item_payments`
 * porte le lien 1:1 vers la ligne `lease_opening_debt_payments` correspondante (jamais les deux de
 * façon indépendante — voir `payOpeningDebtItem`, services/leasePayments.js), ce LEFT JOIN le retrouve.
 */
async function listOpeningDebtPaymentRows(tenantId, from, to) {
  const [rows] = await pool.query(
    `SELECT lodp.*, r.id AS renter_id, r.first_name AS renter_first_name, r.last_name AS renter_last_name,
            u.code AS unit_code, ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name, ru.role AS recorder_role,
            i.debt_type AS item_debt_type, i.period_month AS item_period_month, i.label AS item_label
     FROM lease_opening_debt_payments lodp
     JOIN leases l ON l.id = lodp.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     LEFT JOIN users ru ON ru.id = lodp.recorded_by
     LEFT JOIN lease_opening_debt_item_payments lodip ON lodip.lease_payment_id = lodp.id
     LEFT JOIN lease_opening_debt_items i ON i.id = lodip.item_id
     WHERE lodp.tenant_id = :tenantId AND lodp.paid_at BETWEEN :from AND :to
     ORDER BY lodp.paid_at DESC, lodp.id DESC`,
    { tenantId, from, to },
  );
  return rows;
}

/** Versements aux propriétaires de la période (plus récents d'abord). */
async function listOwnerPayoutRows(tenantId, from, to) {
  const [rows] = await pool.query(
    `SELECT op.*, o.id AS owner_id, o.name AS owner_name,
            ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name, ru.role AS recorder_role
     FROM owner_payouts op
     JOIN owners o ON o.id = op.owner_id
     LEFT JOIN users ru ON ru.id = op.recorded_by
     WHERE op.tenant_id = :tenantId AND op.paid_at BETWEEN :from AND :to
     ORDER BY op.paid_at DESC, op.id DESC`,
    { tenantId, from, to },
  );
  return rows;
}

module.exports = { listUtilityArrearsRows, listRentPaymentRows, listOpeningDebtPaymentRows, listOwnerPayoutRows };
