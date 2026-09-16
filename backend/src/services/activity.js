'use strict';

// Étape 10 (fonctionnalités transversales) : journal d'activité DG — unifie
// les principales actions tracées à travers tous les modules (créations,
// paiements, suppressions...) en un seul flux chronologique, sans nouvelle
// table ni triggers : chaque requête reste une simple lecture des colonnes
// d'auteur/horodatage déjà posées module par module depuis l'étape 8
// (`created_by`, `recorded_by`, `deleted_by`...). Le « Journal des
// suppressions » de l'étape 8 (`GET /api/accounting/deleted-entries`)
// réutilise `listDeletedEntries` ci-dessous — une seule source de vérité.

const { pool } = require('../config/db');
const { toActor } = require('../utils/actor');
const { EXPENSE_CATEGORIES } = require('../constants/expenses');

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * Dépenses et charges SONEB/SBEE supprimées logiquement (suppression =
 * marquage, jamais un DELETE physique — étape 8) : détail, auteur de la
 * suppression, justification obligatoire. Visible du DG uniquement.
 *
 * `actorUserId` (étape 18, historique personnel) restreint aux suppressions
 * effectuées PAR cet utilisateur précis — sinon comportement inchangé.
 */
async function listDeletedEntries(tenantId, actorUserId = null) {
  const p = { tenantId, actorUserId };
  const actorFilter = actorUserId ? 'AND e.deleted_by = :actorUserId' : '';
  const actorFilterUc = actorUserId ? 'AND uc.deleted_by = :actorUserId' : '';
  const [expenseRows] = await pool.query(
    `SELECT e.id, e.category, e.label, e.amount, e.expense_date,
            cu.first_name AS created_first_name, cu.last_name AS created_last_name, cu.role AS created_role,
            du.first_name AS deleted_first_name, du.last_name AS deleted_last_name, du.role AS deleted_role,
            e.deleted_at, e.deleted_reason
     FROM expenses e
     JOIN users cu ON cu.id = e.recorded_by
     JOIN users du ON du.id = e.deleted_by
     WHERE e.tenant_id = :tenantId AND e.deleted_at IS NOT NULL ${actorFilter}
     ORDER BY e.deleted_at DESC`,
    p,
  );
  const [chargeRows] = await pool.query(
    `SELECT uc.id, uc.utility_type, uc.amount, uc.billed_at,
            r.first_name AS renter_first_name, r.last_name AS renter_last_name, un.code AS unit_code,
            cu.first_name AS created_first_name, cu.last_name AS created_last_name, cu.role AS created_role,
            du.first_name AS deleted_first_name, du.last_name AS deleted_last_name, du.role AS deleted_role,
            uc.deleted_at, uc.deleted_reason
     FROM utility_charges uc
     JOIN leases l ON l.id = uc.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units un ON un.id = l.unit_id
     JOIN users cu ON cu.id = uc.recorded_by
     JOIN users du ON du.id = uc.deleted_by
     WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NOT NULL ${actorFilterUc}
     ORDER BY uc.deleted_at DESC`,
    p,
  );

  return [
    ...expenseRows.map((r) => ({
      type: 'expense',
      id: r.id,
      label: `${EXPENSE_CATEGORIES.find((c) => c.key === r.category)?.label ?? r.category} — ${r.label}`,
      amount: Number(r.amount),
      date: isoDate(r.expense_date),
      createdBy: toActor(r.created_first_name, r.created_last_name, r.created_role),
      deletedBy: toActor(r.deleted_first_name, r.deleted_last_name, r.deleted_role),
      deletedAt: r.deleted_at,
      reason: r.deleted_reason,
    })),
    ...chargeRows.map((r) => ({
      type: 'charge',
      id: r.id,
      label: `${r.utility_type === 'soneb' ? 'SONEB' : 'SBEE'} — ${r.renter_first_name} ${r.renter_last_name} (${r.unit_code})`,
      amount: Number(r.amount),
      date: isoDate(r.billed_at),
      createdBy: toActor(r.created_first_name, r.created_last_name, r.created_role),
      deletedBy: toActor(r.deleted_first_name, r.deleted_last_name, r.deleted_role),
      deletedAt: r.deleted_at,
      reason: r.deleted_reason,
    })),
  ].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
}

/**
 * Journal d'activité unifié : les `limitPerType` dernières actions de
 * chaque nature, à travers tous les modules, fusionnées et triées par
 * horodatage. Chaque requête est indépendante et bornée (`LIMIT`) — pas
 * d'UNION SQL géant, plus simple à maintenir et à étendre.
 *
 * `actorUserId` (étape 18, historique personnel comptable/agent) restreint
 * aux actions effectuées PAR cet utilisateur précis (colonne d'auteur —
 * `created_by`/`recorded_by`/`conducted_by`/`closed_by`/`set_by` selon le
 * module) — sinon comportement inchangé, c'est le journal DG complet.
 */
async function listRecentActivity(tenantId, limit = 60, actorUserId = null) {
  const limitPerType = Math.min(limit, 30);
  const p = { tenantId, n: limitPerType, actorUserId };
  const f = (col) => (actorUserId ? `AND ${col} = :actorUserId` : '');

  const [
    renters,
    owners,
    properties,
    units,
    leases,
    rentPayments,
    ownerPayouts,
    expenses,
    charges,
    complaintsReported,
    complaintsResolved,
    moveIns,
    moveOuts,
    periodsClosed,
    commissionRates,
    deleted,
  ] = await Promise.all([
    pool.query(
      `SELECT r.id, r.first_name, r.last_name, r.created_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM renters r LEFT JOIN users u ON u.id = r.created_by
       WHERE r.tenant_id = :tenantId ${f('r.created_by')} ORDER BY r.created_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT o.id, o.name, o.created_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM owners o LEFT JOIN users u ON u.id = o.created_by
       WHERE o.tenant_id = :tenantId ${f('o.created_by')} ORDER BY o.created_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT p.id, p.code, p.created_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM properties p LEFT JOIN users u ON u.id = p.created_by
       WHERE p.tenant_id = :tenantId ${f('p.created_by')} ORDER BY p.created_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT un.id, un.code, un.created_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM property_units un LEFT JOIN users u ON u.id = un.created_by
       WHERE un.tenant_id = :tenantId ${f('un.created_by')} ORDER BY un.created_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT l.id, l.created_at, r.first_name AS r_fn, r.last_name AS r_ln, un.code AS unit_code,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM leases l
       JOIN renters r ON r.id = l.renter_id
       JOIN property_units un ON un.id = l.unit_id
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.tenant_id = :tenantId ${f('l.created_by')} ORDER BY l.created_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT rp.id, rp.amount, rp.covers_month, rp.created_at, r.first_name AS r_fn, r.last_name AS r_ln,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users u ON u.id = rp.recorded_by
       WHERE rp.tenant_id = :tenantId ${f('rp.recorded_by')} ORDER BY rp.created_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT op.id, op.amount, op.created_at, o.name AS owner_name,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM owner_payouts op
       JOIN owners o ON o.id = op.owner_id
       LEFT JOIN users u ON u.id = op.recorded_by
       WHERE op.tenant_id = :tenantId ${f('op.recorded_by')} ORDER BY op.created_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT e.id, e.label, e.amount, e.created_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM expenses e LEFT JOIN users u ON u.id = e.recorded_by
       WHERE e.tenant_id = :tenantId AND e.deleted_at IS NULL ${f('e.recorded_by')} ORDER BY e.created_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT uc.id, uc.utility_type, uc.amount, uc.created_at, r.first_name AS r_fn, r.last_name AS r_ln,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM utility_charges uc
       JOIN leases l ON l.id = uc.lease_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users u ON u.id = uc.recorded_by
       WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NULL ${f('uc.recorded_by')} ORDER BY uc.created_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT c.id, c.code, c.title, c.created_at, c.reported_via_portal,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM complaints c LEFT JOIN users u ON u.id = c.created_by
       WHERE c.tenant_id = :tenantId ${f('c.created_by')} ORDER BY c.created_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT c.id, c.code, c.title, c.updated_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM complaints c LEFT JOIN users u ON u.id = c.resolved_by
       WHERE c.tenant_id = :tenantId AND c.status IN ('resolue', 'fermee') AND c.resolved_by IS NOT NULL
       ${f('c.resolved_by')} ORDER BY c.updated_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT mi.id, mi.finalized_at AS created_at, r.first_name AS r_fn, r.last_name AS r_ln,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM move_in_reports mi
       JOIN leases l ON l.id = mi.lease_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users u ON u.id = mi.finalized_by
       WHERE mi.tenant_id = :tenantId AND mi.status = 'finalized' ${f('mi.finalized_by')} ORDER BY mi.finalized_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT mo.id, mo.finalized_at AS created_at, mo.net_refund, r.first_name AS r_fn, r.last_name AS r_ln,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM move_out_reports mo
       JOIN leases l ON l.id = mo.lease_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users u ON u.id = mo.finalized_by
       WHERE mo.tenant_id = :tenantId AND mo.status = 'finalized' ${f('mo.finalized_by')} ORDER BY mo.finalized_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT ap.id, ap.period, ap.closed_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM accounting_periods ap LEFT JOIN users u ON u.id = ap.closed_by
       WHERE ap.tenant_id = :tenantId ${f('ap.closed_by')} ORDER BY ap.closed_at DESC LIMIT :n`,
      p,
    ),
    pool.query(
      `SELECT cr.id, cr.rate, cr.starts_on, cr.created_at, o.name AS owner_name,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM owner_commission_rates cr
       JOIN owners o ON o.id = cr.owner_id
       LEFT JOIN users u ON u.id = cr.set_by
       WHERE cr.tenant_id = :tenantId ${f('cr.set_by')} ORDER BY cr.created_at DESC LIMIT :n`,
      p,
    ),
    listDeletedEntries(tenantId, actorUserId),
  ]);

  const entries = [
    ...renters[0].map((r) => ({
      type: 'renter_created',
      label: `Locataire créé : ${r.first_name} ${r.last_name}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...owners[0].map((r) => ({
      type: 'owner_created',
      label: `Propriétaire créé : ${r.name}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...properties[0].map((r) => ({
      type: 'property_created',
      label: `Bien créé : ${r.code}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...units[0].map((r) => ({
      type: 'unit_created',
      label: `Unité créée : ${r.code}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...leases[0].map((r) => ({
      type: 'lease_created',
      label: `Bail signé : ${r.r_fn} ${r.r_ln} — ${r.unit_code}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...rentPayments[0].map((r) => ({
      type: 'rent_payment_recorded',
      label: `Paiement loyer : ${r.r_fn} ${r.r_ln} — ${Number(r.amount).toLocaleString('fr-FR')} FCFA (${r.covers_month})`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...ownerPayouts[0].map((r) => ({
      type: 'owner_payout_recorded',
      label: `Versement propriétaire : ${r.owner_name} — ${Number(r.amount).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...expenses[0].map((r) => ({
      type: 'expense_recorded',
      label: `Dépense enregistrée : ${r.label} — ${Number(r.amount).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...charges[0].map((r) => ({
      type: 'charge_recorded',
      label: `Charge ${r.utility_type === 'soneb' ? 'SONEB' : 'SBEE'} : ${r.r_fn} ${r.r_ln} — ${Number(r.amount).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...complaintsReported[0].map((r) => ({
      type: 'complaint_reported',
      label: r.reported_via_portal
        ? `Plainte signalée par le locataire (portail) : ${r.code} — ${r.title}`
        : `Plainte signalée : ${r.code} — ${r.title}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...complaintsResolved[0].map((r) => ({
      type: 'complaint_resolved',
      label: `Plainte résolue : ${r.code} — ${r.title}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.updated_at,
    })),
    ...moveIns[0].map((r) => ({
      type: 'move_in_conducted',
      label: `État des lieux d'entrée : ${r.r_fn} ${r.r_ln}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...moveOuts[0].map((r) => ({
      type: 'move_out_conducted',
      label: `Sortie de locataire : ${r.r_fn} ${r.r_ln} — solde restitué ${Number(r.net_refund).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...periodsClosed[0].map((r) => ({
      type: 'period_closed',
      label: `Mois clôturé : ${r.period}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.closed_at,
    })),
    ...commissionRates[0].map((r) => ({
      type: 'commission_rate_changed',
      label: `Taux de commission modifié : ${r.owner_name} — ${Number(r.rate)} % (à partir du ${isoDate(r.starts_on)})`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role),
      at: r.created_at,
    })),
    ...deleted.map((d) => ({
      type: d.type === 'expense' ? 'expense_deleted' : 'charge_deleted',
      label: `${d.type === 'expense' ? 'Dépense supprimée' : 'Charge supprimée'} : ${d.label} — ${Number(d.amount).toLocaleString('fr-FR')} FCFA`,
      actor: d.deletedBy,
      at: d.deletedAt,
    })),
  ];

  entries.sort((a, b) => new Date(b.at) - new Date(a.at));
  return entries.slice(0, limit);
}

module.exports = { listDeletedEntries, listRecentActivity };
