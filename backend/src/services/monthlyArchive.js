'use strict';

/**
 * Archive mensuelle par locataire (demande explicite de l'utilisateur, 16/10/2026) : à la clôture
 * d'un mois, fige pour chaque bail concerné "le point du mois" complet — loyer, charges
 * SONEB/SBEE, pénalités de retard, note du locataire — dans `monthly_renter_archive`, consultable
 * mais plus jamais modifiable. Distinct de `lease_balance_snapshots` (qui ne fige qu'un seul
 * montant dû, déjà utilisé pour l'historique de solde sur la fiche bail) : cette archive-ci
 * reconstitue l'image complète du mois, affichée dans une vue portefeuille dédiée.
 */

const { pool } = require('../config/db');
const { buildMonthRentPayload } = require('./rentTracking');

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * Appelée une seule fois par `POST /api/accounting/periods`, juste après `snapshotLeaseBalances`,
 * dans son propre try/catch : un échec ici ne doit jamais remettre en cause la clôture elle-même
 * (déjà actée en base à ce stade). INSERT-only — la contrainte UNIQUE (tenant_id, period_start,
 * lease_id) protège aussi contre un double appel accidentel, même principe que
 * `lease_balance_snapshots`.
 *
 * Remet aussi à zéro la note de chaque locataire concerné (décision explicite de l'utilisateur :
 * la note "repart à neuf" pour le nouveau mois qui vient de s'ouvrir) — sa valeur D'AVANT la remise
 * à zéro est ce qui vient d'être figé dans `notes_snapshot`, jamais perdue.
 *
 * Refonte de la clôture (étape 2/5, 2026-10-16) : prend désormais `rhythm` + les bornes RÉELLES déjà
 * calculées par la route de clôture (`periodStart`/`periodEnd`), au lieu de dériver un mois civil
 * depuis une chaîne 'AAAA-MM' — s'exécute maintenant pour TOUT rythme, plus seulement calendaire
 * (l'ancien garde-fou `if (legacyPeriod)` dans la route a été retiré). `period` (étiquette 'AAAA-MM')
 * reste renseignée pour affichage/compatibilité seulement en rythme calendaire ; la vue portefeuille
 * (`getMonthlyArchive`/`GET /periods/:period/archive`) lit par `period_start` depuis l'étape 2c,
 * donc pour tout rythme.
 */
async function archiveMonth(tenantId, rhythm, periodStart, periodEnd) {
  const isCalendaire = (rhythm?.mode ?? 'calendaire') === 'calendaire';
  const first = periodStart;
  const last = periodEnd;
  const legacyPeriod = isCalendaire ? first.slice(0, 7) : null;

  // Portée des baux : même critère que `snapshotLeaseBalances`/`getPeriodClosability` — chevauche
  // la période, actif ou déjà terminé, jamais seulement `status = 'active'`.
  const [leases] = await pool.query(
    `SELECT l.id, l.renter_id, l.monthly_rent, l.start_date, l.end_date, l.rent_due_day, l.rent_due_offset_days, l.rent_timing,
            l.created_at, l.up_to_date_at_onboarding, l.entry_proration
     FROM leases l
     WHERE l.tenant_id = :tenantId AND l.start_date <= :last AND (l.end_date IS NULL OR l.end_date >= :first)`,
    { tenantId, first, last },
  );
  if (leases.length === 0) return;

  const leaseIds = leases.map((l) => l.id);
  const placeholders = leaseIds.map(() => '?').join(',');

  const [payments] = await pool.query(
    isCalendaire
      ? `SELECT lease_id, amount FROM rent_payments
         WHERE lease_id IN (${placeholders}) AND covers_month = ? AND deleted_at IS NULL`
      : `SELECT lease_id, amount FROM rent_payments
         WHERE lease_id IN (${placeholders}) AND covers_period_start = ? AND deleted_at IS NULL`,
    [...leaseIds, isCalendaire ? legacyPeriod : first],
  );
  const paidByLease = new Map();
  for (const p of payments) paidByLease.set(p.lease_id, (paidByLease.get(p.lease_id) ?? 0) + Number(p.amount));

  const [charges] = await pool.query(
    `SELECT uc.id, uc.lease_id, uc.utility_type, uc.amount, uc.status, uc.billed_at, uc.paid_at,
            COALESCE((SELECT SUM(up.amount) FROM utility_payments up WHERE up.charge_id = uc.id), 0) AS paid
     FROM utility_charges uc
     WHERE uc.lease_id IN (${placeholders}) AND uc.billed_at BETWEEN ? AND ? AND uc.deleted_at IS NULL`,
    [...leaseIds, first, last],
  );
  const chargesByLease = new Map();
  for (const c of charges) {
    if (!chargesByLease.has(c.lease_id)) chargesByLease.set(c.lease_id, []);
    chargesByLease.get(c.lease_id).push({
      id: c.id,
      utilityType: c.utility_type,
      amount: Number(c.amount),
      paid: Number(c.paid),
      status: c.status,
      billedAt: isoDate(c.billed_at),
      paidAt: isoDate(c.paid_at),
    });
  }

  const [lateFees] = await pool.query(
    `SELECT lf.id, lf.lease_id, lf.amount, lf.applied_at, lf.reason,
            COALESCE((SELECT SUM(lfp.amount) FROM late_fee_payments lfp WHERE lfp.late_fee_id = lf.id), 0) AS paid
     FROM late_fees lf
     WHERE lf.lease_id IN (${placeholders}) AND lf.applied_at BETWEEN ? AND ?`,
    [...leaseIds, first, last],
  );
  const lateFeesByLease = new Map();
  for (const lf of lateFees) {
    if (!lateFeesByLease.has(lf.lease_id)) lateFeesByLease.set(lf.lease_id, []);
    const paid = Number(lf.paid);
    const remaining = Number(lf.amount) - paid;
    lateFeesByLease.get(lf.lease_id).push({
      id: lf.id,
      amount: Number(lf.amount),
      paid,
      appliedAt: isoDate(lf.applied_at),
      reason: lf.reason,
      status: remaining <= 0 ? 'payee' : paid > 0 ? 'partielle' : 'impayee',
    });
  }

  const renterIds = [...new Set(leases.map((l) => l.renter_id))];
  const [renterRows] = await pool.query(
    `SELECT id, notes FROM renters WHERE id IN (${renterIds.map(() => '?').join(',')})`,
    renterIds,
  );
  const notesByRenter = new Map(renterRows.map((r) => [r.id, r.notes]));

  const periodKey = isCalendaire ? legacyPeriod : first;
  const rows = leases.map((lease) => [
    tenantId,
    legacyPeriod,
    first,
    last,
    lease.id,
    lease.renter_id,
    JSON.stringify(buildMonthRentPayload(lease, periodKey, paidByLease.get(lease.id) ?? 0, last, rhythm)),
    JSON.stringify(chargesByLease.get(lease.id) ?? []),
    JSON.stringify(lateFeesByLease.get(lease.id) ?? []),
    notesByRenter.get(lease.renter_id) ?? null,
  ]);

  await pool.query(
    `INSERT INTO monthly_renter_archive
       (tenant_id, period, period_start, period_end, lease_id, renter_id, rent_payload, charges_payload, late_fees_payload, notes_snapshot)
     VALUES ?`,
    [rows],
  );

  // Remise à zéro APRÈS l'archivage, jamais avant : si l'archivage échoue, la note vivante doit
  // rester intacte (rien n'a été figé, il ne faut rien perdre).
  await pool.query(
    `UPDATE renters SET notes = NULL, notes_updated_by = NULL, notes_updated_at = NULL WHERE id IN (${renterIds.map(() => '?').join(',')})`,
    renterIds,
  );
}

/**
 * Vue portefeuille d'une période déjà clôturée (lecture seule), identifiée par sa date de début
 * réelle (étape 2c — valable pour tout rythme ; en calendaire, c'est le 1er du mois). L'appelant
 * (route) est responsable de vérifier que la période est bien clôturée avant d'appeler cette fonction.
 */
async function getMonthlyArchive(tenantId, periodStart, scopeAgentId = null) {
  const params = { tenantId, periodStart };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT mra.lease_id, mra.renter_id, mra.rent_payload, mra.charges_payload, mra.late_fees_payload,
            mra.notes_snapshot, mra.created_at,
            r.first_name, r.last_name, r.phone,
            un.code AS unit_code, p.code AS property_code
     FROM monthly_renter_archive mra
     JOIN leases l ON l.id = mra.lease_id
     JOIN renters r ON r.id = mra.renter_id
     JOIN property_units un ON un.id = l.unit_id
     JOIN properties p ON p.id = un.property_id
     WHERE mra.tenant_id = :tenantId AND mra.period_start = :periodStart ${scopeClause}
     ORDER BY p.code ASC, un.code ASC`,
    params,
  );
  return rows.map((r) => ({
    leaseId: r.lease_id,
    renterId: r.renter_id,
    renterName: `${r.first_name} ${r.last_name}`,
    phone: r.phone,
    unitCode: r.unit_code,
    propertyCode: r.property_code,
    rent: r.rent_payload,
    charges: r.charges_payload,
    lateFees: r.late_fees_payload,
    notesSnapshot: r.notes_snapshot,
    archivedAt: r.created_at,
  }));
}

module.exports = { archiveMonth, getMonthlyArchive };
