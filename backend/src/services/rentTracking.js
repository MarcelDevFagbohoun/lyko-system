'use strict';

const { pool } = require('../config/db');

/** Mois suivant au format 'YYYY-MM'. */
function addMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1)); // m (non m-1) avance déjà d'un mois
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Calcule le statut de paiement d'un bail : mois payés (à partir de la date
 * de début et des paiements enregistrés), prochaine échéance, retard éventuel.
 * `payments` : tableau de { coversMonth: 'YYYY-MM' }.
 */
function computeArrears({ startDate, rentDueDay, payments }, today = new Date()) {
  const startMonth = startDate.slice(0, 7);
  const paidThrough =
    payments.length > 0 ? payments.map((p) => p.coversMonth).sort().at(-1) : null;
  const nextDueMonth = paidThrough && paidThrough >= startMonth ? addMonth(paidThrough) : startMonth;

  const [y, m] = nextDueMonth.split('-').map(Number);
  const dueDate = new Date(Date.UTC(y, m - 1, rentDueDay));
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const daysLate = Math.floor((todayUtc - dueDate) / 86_400_000);

  return {
    paidThroughMonth: paidThrough,
    nextDueMonth,
    dueDate: dueDate.toISOString().slice(0, 10),
    daysLate,
    status: daysLate > 0 ? 'late' : 'current',
  };
}

/**
 * Répartit un montant total sur des mois de loyer consécutifs à partir de
 * `nextDueMonth` : autant de mois complets que le montant le permet, puis le
 * reste éventuel en paiement partiel sur le mois suivant (décision produit :
 * « mois entiers + reste en partiel »). Renvoie la liste des écritures à créer,
 * une par mois (chacune donnera lieu à sa propre quittance).
 */
function allocateRentPayment({ nextDueMonth, monthlyRent, amount }) {
  const rent = Number(monthlyRent);
  const total = Number(amount);
  const fullMonths = rent > 0 ? Math.floor(total / rent) : 0;
  const partialAmount = rent > 0 ? total % rent : total;

  const allocations = [];
  let month = nextDueMonth;
  for (let i = 0; i < fullMonths; i += 1) {
    allocations.push({ coversMonth: month, amount: rent, isPartial: false });
    month = addMonth(month);
  }
  if (partialAmount > 0) {
    allocations.push({ coversMonth: month, amount: partialAmount, isPartial: true });
  }
  return { fullMonths, partialAmount, monthsCovered: allocations.length, allocations };
}

/** Nombre de mois entre deux 'AAAA-MM' inclus (>= 1 si `to` >= `from`). */
function monthsBetweenInclusive(fromYm, toYm) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Liste tous les baux actifs en retard de paiement pour l'ensemble du
 * portefeuille d'un tenant (pas seulement une période) — utilisée par le
 * tableau de bord comptable (étape 8, impayés locataires) et le centre de
 * relance groupée (étape 10). Le montant dû reste une estimation calculée
 * automatiquement (mois dus × loyer), jamais une saisie.
 *
 * `scopeAgentId` (étape 14) : un agent restreint ne voit que les impayés des
 * baux sur un Bien qui lui est attribué — voir services/scope.js.
 */
async function listPortfolioArrears(tenantId, scopeAgentId = null) {
  const params = { tenantId };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [activeLeases] = await pool.query(
    `SELECT l.id, l.monthly_rent, l.start_date, l.rent_due_day,
            r.id AS renter_id, r.first_name, r.last_name, r.phone,
            un.code AS unit_code, p.code AS property_code
     FROM leases l
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units un ON un.id = l.unit_id
     JOIN properties p ON p.id = un.property_id
     WHERE l.tenant_id = :tenantId AND l.status = 'active' ${scopeClause}`,
    params,
  );
  if (activeLeases.length === 0) return [];

  const leaseIds = activeLeases.map((l) => l.id);
  const placeholders = leaseIds.map(() => '?').join(',');
  const [payments] = await pool.query(
    `SELECT lease_id, covers_month FROM rent_payments WHERE lease_id IN (${placeholders})`,
    leaseIds,
  );
  const paymentsByLease = new Map();
  for (const p of payments) {
    if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
    paymentsByLease.get(p.lease_id).push({ coversMonth: p.covers_month });
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const results = [];
  for (const lease of activeLeases) {
    const startDate = lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
    const arrears = computeArrears({
      startDate,
      rentDueDay: lease.rent_due_day,
      payments: paymentsByLease.get(lease.id) || [],
    });
    if (arrears.status === 'late') {
      const unpaidMonths = Math.max(1, monthsBetweenInclusive(arrears.nextDueMonth, currentMonth));
      results.push({
        leaseId: lease.id,
        renterId: lease.renter_id,
        renterName: `${lease.first_name} ${lease.last_name}`,
        phone: lease.phone,
        unitCode: lease.unit_code,
        propertyCode: lease.property_code,
        monthlyRent: Number(lease.monthly_rent),
        dueDate: arrears.dueDate,
        daysLate: arrears.daysLate,
        unpaidMonths,
        amountOwed: unpaidMonths * Number(lease.monthly_rent),
      });
    }
  }
  return results;
}

module.exports = {
  computeArrears,
  addMonth,
  allocateRentPayment,
  monthsBetweenInclusive,
  listPortfolioArrears,
};
