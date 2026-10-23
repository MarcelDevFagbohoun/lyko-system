'use strict';

// « Point de sortie » : décompte complet de la caution à la sortie du locataire. Même calcul que celui
// de la finalisation (routes/leases.js) mais en lecture seule, daté au jour de l'état des lieux, pour
// l'afficher à l'écran et sur le PV avant de signer.
const { computeRentOwed } = require('./rentTracking');
const { getUnpaidUtilityBalance } = require('./leaseDeposits');

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** Libellés des mois impayés (rythme calendaire uniquement ; sinon vide — seul le nombre est connu). */
function unpaidMonthLabels(arrears, unpaidMonths) {
  const start = arrears?.nextDueMonth;
  if (!start || !/^\d{4}-\d{2}/.test(String(start)) || !unpaidMonths) return [];
  const [y, m] = String(start).slice(0, 7).split('-').map(Number);
  return Array.from({ length: unpaidMonths }, (_, i) => {
    const idx = m - 1 + i;
    return `${MONTHS[idx % 12]} ${y + Math.floor(idx / 12)}`;
  });
}

async function computeMoveOutStatement(conn, { tenantId, lease, report, deposits = [] }) {
  const isCalendaire = lease.rent_due_day != null;
  const [payments] = await conn.query(
    'SELECT covers_month, covers_period_start, amount FROM rent_payments WHERE lease_id = :leaseId AND deleted_at IS NULL',
    { leaseId: lease.id },
  );
  const { arrears, unpaidMonths, rentOwed } = computeRentOwed({
    lease,
    payments: payments.map((p) => ({
      coversMonth: isCalendaire ? p.covers_month : iso(p.covers_period_start),
      amount: Number(p.amount),
    })),
    rhythm: { mode: isCalendaire ? 'calendaire' : 'jour_fixe' },
    asOfDate: iso(report.conducted_at),
  });

  const items = typeof report.items === 'string' ? JSON.parse(report.items) : report.items;
  const zones = Array.isArray(items) ? items : items?.zones ?? [];
  const itemsDeductions = zones.reduce((s, z) => s + (z.items ?? []).reduce((t, it) => t + (Number(it.deduction) || 0), 0), 0);
  const extraLines = report.extra_lines ? (typeof report.extra_lines === 'string' ? JSON.parse(report.extra_lines) : report.extra_lines) : [];
  const extraTotal = extraLines.reduce((s, l) => s + (l.kind === 'realisee_locataire' ? 0 : Number(l.amount) || 0), 0);

  const peintureDep = deposits.find((d) => d.type === 'peinture' && d.status === 'held');
  const peintureAmount = Number(report.peinture_deduction_amount) || 0;
  const peintureOverflow = peintureDep ? Math.max(0, peintureAmount - Number(peintureDep.amount)) : 0;

  const utilities = [];
  for (const d of deposits.filter((x) => (x.type === 'sbee' || x.type === 'soneb') && x.status === 'held')) {
    const unpaid = await getUnpaidUtilityBalance(conn, tenantId, lease.id, d.type);
    utilities.push({ type: d.type, unpaid, deposit: Number(d.amount), excess: Math.max(0, unpaid - Number(d.amount)) });
  }

  const depositAmount = Number(report.deposit_amount);
  const grossDue = itemsDeductions + extraTotal + peintureOverflow + rentOwed;
  const totalDeductions = Math.min(grossDue, depositAmount);
  return {
    asOf: iso(report.conducted_at),
    depositAmount,
    rent: { owed: rentOwed, months: unpaidMonthLabels(arrears, unpaidMonths), monthsCount: unpaidMonths },
    itemsDeductions,
    extraLines,
    extraTotal,
    peintureOverflow,
    utilities,
    grossDue,
    totalDeductions,
    netRefund: Math.max(0, depositAmount - grossDue),
    shortfall: Math.max(0, grossDue - depositAmount),
  };
}

module.exports = { computeMoveOutStatement };
