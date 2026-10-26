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
const { resolveRoleLabels } = require('../constants/roles');
const { isoDate } = require('../utils/dates');

/** Libellés de rôles personnalisés de l'entreprise (Réglages) — un aller
 * simple en base, réutilisé pour toutes les attributions `toActor` d'un
 * même appel plutôt que redemandé à chaque ligne. */
async function fetchRoleLabels(tenantId) {
  const [[tenant]] = await pool.query(
    'SELECT dg_title, comptable_title, agent_title FROM tenants WHERE id = :tenantId LIMIT 1',
    { tenantId },
  );
  return resolveRoleLabels(tenant);
}

/**
 * Dépenses et charges SONEB/SBEE supprimées logiquement (suppression =
 * marquage, jamais un DELETE physique — étape 8) : détail, auteur de la
 * suppression, justification obligatoire. Visible du DG uniquement.
 *
 * `actorUserId` (étape 18, historique personnel) restreint aux suppressions
 * effectuées PAR cet utilisateur précis — sinon comportement inchangé.
 *
 * `filters.date` ('AAAA-MM-DD') / `filters.month` ('AAAA-MM') (nouveau,
 * filtres du Journal d'activité) restreignent sur la date de suppression —
 * `date` prioritaire si les deux sont fournis. Absents par défaut, donc
 * sans effet sur l'appel existant du « Journal des suppressions ».
 */
async function listDeletedEntries(tenantId, actorUserId = null, roleLabels = null, filters = {}) {
  if (!roleLabels) roleLabels = await fetchRoleLabels(tenantId);
  const p = { tenantId, actorUserId, filterDate: filters.date ?? null, filterMonth: filters.month ?? null };
  const actorFilter = actorUserId ? 'AND e.deleted_by = :actorUserId' : '';
  const actorFilterUc = actorUserId ? 'AND uc.deleted_by = :actorUserId' : '';
  const dateCond = (col) => (filters.date ? `AND DATE(${col}) = :filterDate` : filters.month ? `AND DATE_FORMAT(${col}, '%Y-%m') = :filterMonth` : '');
  const [expenseRows] = await pool.query(
    `SELECT e.id, e.category, e.label, e.amount, e.expense_date,
            cu.first_name AS created_first_name, cu.last_name AS created_last_name, cu.role AS created_role,
            du.first_name AS deleted_first_name, du.last_name AS deleted_last_name, du.role AS deleted_role,
            e.deleted_at, e.deleted_reason
     FROM expenses e
     JOIN users cu ON cu.id = e.recorded_by
     JOIN users du ON du.id = e.deleted_by
     WHERE e.tenant_id = :tenantId AND e.deleted_at IS NOT NULL ${actorFilter} ${dateCond('e.deleted_at')}
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
     WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NOT NULL ${actorFilterUc} ${dateCond('uc.deleted_at')}
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
      createdBy: toActor(r.created_first_name, r.created_last_name, r.created_role, roleLabels),
      deletedBy: toActor(r.deleted_first_name, r.deleted_last_name, r.deleted_role, roleLabels),
      deletedAt: r.deleted_at,
      reason: r.deleted_reason,
    })),
    ...chargeRows.map((r) => ({
      type: 'charge',
      id: r.id,
      label: `${r.utility_type === 'soneb' ? 'SONEB' : 'SBEE'} — ${r.renter_first_name} ${r.renter_last_name} (${r.unit_code})`,
      amount: Number(r.amount),
      date: isoDate(r.billed_at),
      createdBy: toActor(r.created_first_name, r.created_last_name, r.created_role, roleLabels),
      deletedBy: toActor(r.deleted_first_name, r.deleted_last_name, r.deleted_role, roleLabels),
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
 *
 * `filters` (nouveau, filtres du Journal d'activité) :
 * - `filters.date` ('AAAA-MM-DD') / `filters.month` ('AAAA-MM') — restreint
 *   chaque requête sur sa colonne de date (`date` prioritaire). Comme un
 *   jour/mois donné produit naturellement peu de lignes par type, le
 *   plafond par requête est relevé (voir `limitPerType`) plutôt que de
 *   risquer de couper des résultats déjà filtrés en SQL.
 * - `filters.type` — un seul type d'activité (ex. `rent_payment_recorded`).
 *   N'exécute que la requête source correspondante (les autres sont
 *   remplacées par une résolution immédiate) ; un filtre final sur `type`
 *   reste appliqué après fusion, qui fait foi pour l'exactitude — le choix
 *   des requêtes à sauter n'est qu'une optimisation.
 * Tous facultatifs, absents par défaut : comportement du journal DG complet
 * inchangé pour les deux appelants existants qui ne les passent pas encore.
 */
async function listRecentActivity(tenantId, limit = 60, actorUserId = null, filters = {}) {
  const narrowed = Boolean(filters.date || filters.month || filters.type);
  const limitPerType = Math.min(limit, narrowed ? 200 : 30);
  const p = {
    tenantId, n: limitPerType, actorUserId,
    filterDate: filters.date ?? null, filterMonth: filters.month ?? null,
  };
  const f = (col) => (actorUserId ? `AND ${col} = :actorUserId` : '');
  const d = (col) => (filters.date ? `AND DATE(${col}) = :filterDate` : filters.month ? `AND DATE_FORMAT(${col}, '%Y-%m') = :filterMonth` : '');
  const roleLabels = await fetchRoleLabels(tenantId);

  // Quand un type précis est demandé, seule sa requête source est utile —
  // les autres seraient de la bande passante gaspillée, remplacées par une
  // résolution immédiate de forme identique (`[[]]`, comme `pool.query`).
  const only = (sectionType, queryPromise) => (filters.type && filters.type !== sectionType ? Promise.resolve([[]]) : queryPromise);
  const deletedTypes = ['expense_deleted', 'charge_deleted'];
  const onlyDeleted = (queryPromise) => (filters.type && !deletedTypes.includes(filters.type) ? Promise.resolve([]) : queryPromise);

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
    moveInsReopened,
    moveOutsReopened,
    periodsClosed,
    commissionRates,
    chargeRemittances,
    chargeRemittancesCancelled,
    mainInvoicePayments,
    deleted,
  ] = await Promise.all([
    only('renter_created', pool.query(
      `SELECT r.id, r.first_name, r.last_name, r.created_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM renters r LEFT JOIN users u ON u.id = r.created_by
       WHERE r.tenant_id = :tenantId ${f('r.created_by')} ${d('r.created_at')} ORDER BY r.created_at DESC LIMIT :n`,
      p,
    )),
    only('owner_created', pool.query(
      `SELECT o.id, o.name, o.created_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM owners o LEFT JOIN users u ON u.id = o.created_by
       WHERE o.tenant_id = :tenantId ${f('o.created_by')} ${d('o.created_at')} ORDER BY o.created_at DESC LIMIT :n`,
      p,
    )),
    only('property_created', pool.query(
      `SELECT p.id, p.code, p.created_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM properties p LEFT JOIN users u ON u.id = p.created_by
       WHERE p.tenant_id = :tenantId ${f('p.created_by')} ${d('p.created_at')} ORDER BY p.created_at DESC LIMIT :n`,
      p,
    )),
    only('unit_created', pool.query(
      `SELECT un.id, un.code, un.created_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM property_units un LEFT JOIN users u ON u.id = un.created_by
       WHERE un.tenant_id = :tenantId ${f('un.created_by')} ${d('un.created_at')} ORDER BY un.created_at DESC LIMIT :n`,
      p,
    )),
    only('lease_created', pool.query(
      `SELECT l.id, l.created_at, r.first_name AS r_fn, r.last_name AS r_ln, un.code AS unit_code,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM leases l
       JOIN renters r ON r.id = l.renter_id
       JOIN property_units un ON un.id = l.unit_id
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.tenant_id = :tenantId ${f('l.created_by')} ${d('l.created_at')} ORDER BY l.created_at DESC LIMIT :n`,
      p,
    )),
    only('rent_payment_recorded', pool.query(
      `SELECT rp.id, rp.amount, rp.covers_month, rp.covers_period_start, rp.created_at, rp.payment_method, r.first_name AS r_fn, r.last_name AS r_ln,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users u ON u.id = rp.recorded_by
       WHERE rp.tenant_id = :tenantId AND rp.deleted_at IS NULL ${f('rp.recorded_by')} ${d('rp.created_at')} ORDER BY rp.created_at DESC LIMIT :n`,
      p,
    )),
    only('owner_payout_recorded', pool.query(
      `SELECT op.id, op.amount, op.created_at, o.name AS owner_name,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM owner_payouts op
       JOIN owners o ON o.id = op.owner_id
       LEFT JOIN users u ON u.id = op.recorded_by
       WHERE op.tenant_id = :tenantId ${f('op.recorded_by')} ${d('op.created_at')} ORDER BY op.created_at DESC LIMIT :n`,
      p,
    )),
    only('expense_recorded', pool.query(
      `SELECT e.id, e.label, e.amount, e.created_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM expenses e LEFT JOIN users u ON u.id = e.recorded_by
       WHERE e.tenant_id = :tenantId AND e.deleted_at IS NULL ${f('e.recorded_by')} ${d('e.created_at')} ORDER BY e.created_at DESC LIMIT :n`,
      p,
    )),
    only('charge_recorded', pool.query(
      `SELECT uc.id, uc.utility_type, uc.amount, uc.created_at, r.first_name AS r_fn, r.last_name AS r_ln,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM utility_charges uc
       JOIN leases l ON l.id = uc.lease_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users u ON u.id = uc.recorded_by
       WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NULL ${f('uc.recorded_by')} ${d('uc.created_at')} ORDER BY uc.created_at DESC LIMIT :n`,
      p,
    )),
    only('complaint_reported', pool.query(
      `SELECT c.id, c.code, c.title, c.created_at, c.reported_via_portal,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM complaints c LEFT JOIN users u ON u.id = c.created_by
       WHERE c.tenant_id = :tenantId ${f('c.created_by')} ${d('c.created_at')} ORDER BY c.created_at DESC LIMIT :n`,
      p,
    )),
    only('complaint_resolved', pool.query(
      `SELECT c.id, c.code, c.title, c.updated_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM complaints c LEFT JOIN users u ON u.id = c.resolved_by
       WHERE c.tenant_id = :tenantId AND c.status IN ('resolue', 'fermee') AND c.resolved_by IS NOT NULL
       ${f('c.resolved_by')} ${d('c.updated_at')} ORDER BY c.updated_at DESC LIMIT :n`,
      p,
    )),
    only('move_in_conducted', pool.query(
      `SELECT mi.id, mi.finalized_at AS created_at, r.first_name AS r_fn, r.last_name AS r_ln,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM move_in_reports mi
       JOIN leases l ON l.id = mi.lease_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users u ON u.id = mi.finalized_by
       WHERE mi.tenant_id = :tenantId AND mi.status = 'finalized' ${f('mi.finalized_by')} ${d('mi.finalized_at')} ORDER BY mi.finalized_at DESC LIMIT :n`,
      p,
    )),
    only('move_out_conducted', pool.query(
      `SELECT mo.id, mo.finalized_at AS created_at, mo.net_refund, r.first_name AS r_fn, r.last_name AS r_ln,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM move_out_reports mo
       JOIN leases l ON l.id = mo.lease_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users u ON u.id = mo.finalized_by
       WHERE mo.tenant_id = :tenantId AND mo.status = 'finalized' ${f('mo.finalized_by')} ${d('mo.finalized_at')} ORDER BY mo.finalized_at DESC LIMIT :n`,
      p,
    )),
    // Réouvertures (étape 48, correction DG) — fiches finalisées rouvertes
    // pour corriger une erreur de saisie, motif obligatoire ; le motif lui-
    // même reste dans `reopen_reason` (consultable sur la fiche), pas
    // reproduit ici pour garder le journal lisible en une ligne.
    only('move_in_reopened', pool.query(
      `SELECT mi.id, mi.reopened_at AS created_at, r.first_name AS r_fn, r.last_name AS r_ln,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM move_in_reports mi
       JOIN leases l ON l.id = mi.lease_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users u ON u.id = mi.reopened_by
       WHERE mi.tenant_id = :tenantId AND mi.reopened_at IS NOT NULL ${f('mi.reopened_by')} ${d('mi.reopened_at')} ORDER BY mi.reopened_at DESC LIMIT :n`,
      p,
    )),
    only('move_out_reopened', pool.query(
      `SELECT mo.id, mo.reopened_at AS created_at, r.first_name AS r_fn, r.last_name AS r_ln,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM move_out_reports mo
       JOIN leases l ON l.id = mo.lease_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN users u ON u.id = mo.reopened_by
       WHERE mo.tenant_id = :tenantId AND mo.reopened_at IS NOT NULL ${f('mo.reopened_by')} ${d('mo.reopened_at')} ORDER BY mo.reopened_at DESC LIMIT :n`,
      p,
    )),
    only('period_closed', pool.query(
      `SELECT ap.id, ap.period, ap.closed_at, u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM accounting_periods ap LEFT JOIN users u ON u.id = ap.closed_by
       WHERE ap.tenant_id = :tenantId ${f('ap.closed_by')} ${d('ap.closed_at')} ORDER BY ap.closed_at DESC LIMIT :n`,
      p,
    )),
    only('commission_rate_changed', pool.query(
      `SELECT cr.id, cr.rate, cr.starts_on, cr.created_at, o.name AS owner_name,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM owner_commission_rates cr
       JOIN owners o ON o.id = cr.owner_id
       LEFT JOIN users u ON u.id = cr.set_by
       WHERE cr.tenant_id = :tenantId ${f('cr.set_by')} ${d('cr.created_at')} ORDER BY cr.created_at DESC LIMIT :n`,
      p,
    )),
    only('charge_remittance_recorded', pool.query(
      `SELECT cr.id, cr.amount, cr.created_at, o.name AS owner_name,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM owner_charge_remittances cr
       JOIN owners o ON o.id = cr.owner_id
       LEFT JOIN users u ON u.id = cr.recorded_by
       WHERE cr.tenant_id = :tenantId ${f('cr.recorded_by')} ${d('cr.created_at')} ORDER BY cr.created_at DESC LIMIT :n`,
      p,
    )),
    only('charge_remittance_cancelled', pool.query(
      `SELECT cr.id, cr.amount, cr.deleted_at, o.name AS owner_name,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM owner_charge_remittances cr
       JOIN owners o ON o.id = cr.owner_id
       LEFT JOIN users u ON u.id = cr.deleted_by
       WHERE cr.tenant_id = :tenantId AND cr.deleted_at IS NOT NULL ${f('cr.deleted_by')} ${d('cr.deleted_at')} ORDER BY cr.deleted_at DESC LIMIT :n`,
      p,
    )),
    only('main_invoice_payment_declared', pool.query(
      `SELECT b.id, b.utility_type, b.period_start, b.main_paid_amount, b.main_paid_recorded_at, pr.code AS property_code,
              u.first_name AS a_fn, u.last_name AS a_ln, u.role AS a_role
       FROM utility_reading_batches b
       JOIN properties pr ON pr.id = b.property_id
       LEFT JOIN users u ON u.id = b.main_paid_recorded_by
       WHERE b.tenant_id = :tenantId AND b.main_paid_amount IS NOT NULL ${f('b.main_paid_recorded_by')} ${d('b.main_paid_recorded_at')}
       ORDER BY b.main_paid_recorded_at DESC LIMIT :n`,
      p,
    )),
    onlyDeleted(listDeletedEntries(tenantId, actorUserId, roleLabels, filters)),
  ]);

  const entries = [
    ...renters[0].map((r) => ({
      type: 'renter_created',
      label: `Locataire créé : ${r.first_name} ${r.last_name}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...owners[0].map((r) => ({
      type: 'owner_created',
      label: `Propriétaire créé : ${r.name}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...properties[0].map((r) => ({
      type: 'property_created',
      label: `Bien créé : ${r.code}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...units[0].map((r) => ({
      type: 'unit_created',
      label: `Unité créée : ${r.code}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...leases[0].map((r) => ({
      type: 'lease_created',
      label: `Bail signé : ${r.r_fn} ${r.r_ln} — ${r.unit_code}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...rentPayments[0].map((r) => ({
      type: 'rent_payment_recorded',
      // `covers_month` ('AAAA-MM') n'est renseignée que pour un bail calendaire (migration 085) —
      // repli sur `covers_period_start` sinon, plutôt qu'afficher littéralement "(null)".
      label: `Paiement loyer : ${r.r_fn} ${r.r_ln} — ${Number(r.amount).toLocaleString('fr-FR')} FCFA (${
        r.covers_month ?? (r.covers_period_start instanceof Date ? r.covers_period_start.toISOString().slice(0, 10) : r.covers_period_start)
      })`,
      // `recorded_by` est NULL pour un paiement confirmé par FedaPay (aucun
      // employé ne l'a saisi) — un intitulé explicite plutôt que le
      // « Auteur inconnu » générique de `toActor(null, ...)`, qui suggérerait
      // à tort un problème de données.
      actor:
        r.a_fn == null && r.a_ln == null
          ? { name: 'Paiement en ligne', role: 'en_ligne', roleLabel: 'Paiement en ligne' }
          : toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...ownerPayouts[0].map((r) => ({
      type: 'owner_payout_recorded',
      label: `Versement propriétaire : ${r.owner_name} — ${Number(r.amount).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...expenses[0].map((r) => ({
      type: 'expense_recorded',
      label: `Dépense enregistrée : ${r.label} — ${Number(r.amount).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...charges[0].map((r) => ({
      type: 'charge_recorded',
      label: `Charge ${r.utility_type === 'soneb' ? 'SONEB' : 'SBEE'} : ${r.r_fn} ${r.r_ln} — ${Number(r.amount).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...complaintsReported[0].map((r) => ({
      type: 'complaint_reported',
      label: r.reported_via_portal
        ? `Plainte signalée par le locataire (portail) : ${r.code} — ${r.title}`
        : `Plainte signalée : ${r.code} — ${r.title}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...complaintsResolved[0].map((r) => ({
      type: 'complaint_resolved',
      label: `Plainte résolue : ${r.code} — ${r.title}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.updated_at,
    })),
    ...moveIns[0].map((r) => ({
      type: 'move_in_conducted',
      label: `État des lieux d'entrée : ${r.r_fn} ${r.r_ln}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...moveOuts[0].map((r) => ({
      type: 'move_out_conducted',
      label: `Sortie de locataire : ${r.r_fn} ${r.r_ln} — solde restitué ${Number(r.net_refund).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...moveInsReopened[0].map((r) => ({
      type: 'move_in_reopened',
      label: `État des lieux d'entrée rouvert pour correction : ${r.r_fn} ${r.r_ln}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...moveOutsReopened[0].map((r) => ({
      type: 'move_out_reopened',
      label: `État des lieux de sortie rouvert pour correction : ${r.r_fn} ${r.r_ln}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...periodsClosed[0].map((r) => ({
      type: 'period_closed',
      label: `Mois clôturé : ${r.period}`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.closed_at,
    })),
    ...commissionRates[0].map((r) => ({
      type: 'commission_rate_changed',
      label: `Taux de commission modifié : ${r.owner_name} — ${Number(r.rate)} % (à partir du ${isoDate(r.starts_on)})`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...chargeRemittances[0].map((r) => ({
      type: 'charge_remittance_recorded',
      label: `Reversement de charges au propriétaire : ${r.owner_name} — ${Number(r.amount).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.created_at,
    })),
    ...chargeRemittancesCancelled[0].map((r) => ({
      type: 'charge_remittance_cancelled',
      label: `Reversement de charges annulé : ${r.owner_name} — ${Number(r.amount).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.deleted_at,
    })),
    ...mainInvoicePayments[0].map((r) => ({
      type: 'main_invoice_payment_declared',
      label: `Facture mère ${r.utility_type === 'soneb' ? 'SONEB' : 'SBEE'} déclarée payée : ${r.property_code} (${isoDate(r.period_start).slice(0, 7)}) — ${Number(r.main_paid_amount).toLocaleString('fr-FR')} FCFA`,
      actor: toActor(r.a_fn, r.a_ln, r.a_role, roleLabels),
      at: r.main_paid_recorded_at,
    })),
    ...deleted.map((d) => ({
      type: d.type === 'expense' ? 'expense_deleted' : 'charge_deleted',
      label: `${d.type === 'expense' ? 'Dépense supprimée' : 'Charge supprimée'} : ${d.label} — ${Number(d.amount).toLocaleString('fr-FR')} FCFA`,
      actor: d.deletedBy,
      at: d.deletedAt,
    })),
  ];

  const filtered = filters.type ? entries.filter((e) => e.type === filters.type) : entries;
  filtered.sort((a, b) => new Date(b.at) - new Date(a.at));
  return filtered.slice(0, limit);
}

module.exports = { listDeletedEntries, listRecentActivity };
