'use strict';

/**
 * Tendances du tableau de bord DG : loyers encaissés, impayés, recette du cabinet, dépenses, occupation, mois par mois,
 * plus le cumul jour par jour du mois en cours contre le précédent. Aucun calcul nouveau : chaque chiffre vient du même
 * service que l'écran correspondant (recette du cabinet = `getCabinetRevenue`, impayés = `listPortfolioArrears` à la fin
 * du mois), pour que le graphe et la carte ne divergent jamais.
 */
const { pool } = require('../config/db');
const { getCabinetRevenue } = require('./commission');
const { listPortfolioArrears } = require('./rentTracking');
const { EXPENSE_CATEGORY_KEYS } = require('../constants/expenses');

const MIN_MONTHS = 3;
const MAX_MONTHS = 12;
const BATCH = 3; // les calculs par mois sont lourds : quelques-uns à la fois, jamais tous en même temps

const clampMonths = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, n)) : 6;
};
const addMonths = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const lastDay = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
// Mois courant à l'heure du Bénin (UTC+1, sans heure d'été).
const beninNow = () => new Date(Date.now() + 3600 * 1000);
async function inBatches(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(...await Promise.all(items.slice(i, i + BATCH).map(fn)));
  return out;
}

async function getTrends(tenantId, monthsParam) {
  const months = clampMonths(monthsParam);
  const now = beninNow();
  const current = now.toISOString().slice(0, 7);
  const today = now.getUTCDate();
  const todayIso = now.toISOString().slice(0, 10);
  const keys = Array.from({ length: months }, (_, i) => addMonths(current, i - months + 1));
  const from = `${keys[0]}-01`;
  const prevKey = addMonths(current, -1);

  const [rentRows] = await pool.query(
    `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS k, SUM(amount) AS amount, COUNT(*) AS n FROM rent_payments
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND paid_at >= :from GROUP BY k`, { tenantId, from },
  );
  const [dayRows] = await pool.query(
    `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS k, DAY(paid_at) AS d, SUM(amount) AS amount FROM rent_payments
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND paid_at >= :prev GROUP BY k, d`, { tenantId, prev: `${prevKey}-01` },
  );
  const [catRows] = await pool.query(
    `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS k, category, SUM(amount) AS amount FROM expenses
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND property_id IS NULL AND payment_status = 'paid' AND paid_at >= :from
     GROUP BY k, category`, { tenantId, from },
  );

  // Recette du cabinet et impayés : mêmes services que les écrans de comptabilité, un mois à la fois.
  const perMonth = await inBatches(keys, async (k) => {
    const rev = await getCabinetRevenue(tenantId, k);
    const arrears = await listPortfolioArrears(tenantId, null, k === current ? null : `${k}-${String(lastDay(k)).padStart(2, '0')}`);
    return { k, rev, arrears: { total: arrears.reduce((s, a) => s + a.amountOwed, 0), count: arrears.length } };
  });

  // Occupation à la fin de chaque mois : unités existantes et unités ayant un bail en cours à cette date.
  const occupancy = await inBatches(keys, async (k) => {
    const end = k === current ? todayIso : `${k}-${String(lastDay(k)).padStart(2, '0')}`;
    const [[r]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM property_units WHERE tenant_id = :tenantId AND DATE(created_at) <= :end) AS total,
              (SELECT COUNT(DISTINCT l.unit_id) FROM leases l WHERE l.tenant_id = :tenantId AND l.start_date <= :end AND (l.end_date IS NULL OR l.end_date >= :end)) AS occupied`,
      { tenantId, end },
    );
    const total = Number(r.total); const occupied = Math.min(Number(r.occupied), total || Number(r.occupied));
    return { k, total, occupied, rate: total > 0 ? occupied / total : null };
  });

  const rentMap = new Map(rentRows.map((r) => [r.k, r]));
  const series = keys.map((k) => {
    const pm = perMonth.find((x) => x.k === k);
    const occ = occupancy.find((x) => x.k === k);
    const cats = Object.fromEntries(EXPENSE_CATEGORY_KEYS.map((c) => [c, Number(catRows.find((r) => r.k === k && r.category === c)?.amount ?? 0)]));
    const b = pm.rev.breakdown;
    return {
      month: k,
      rentCollected: Number(rentMap.get(k)?.amount ?? 0),
      rentPayments: Number(rentMap.get(k)?.n ?? 0),
      arrears: pm.arrears.total,
      arrearsCount: pm.arrears.count,
      revenue: { commission: b.commission, entryFees: b.entryFees, lateFees: b.lateFees, saleCommissions: b.saleCommissions, otherIncomes: b.otherIncomes ?? 0, expenses: b.expenses, net: pm.rev.netCabinetIncome },
      expensesByCategory: cats,
      occupancy: { total: occ.total, occupied: occ.occupied, rate: occ.rate },
    };
  });

  const cumul = (key, days) => {
    let run = 0;
    return Array.from({ length: days }, (_, i) => {
      run += Number(dayRows.find((r) => r.k === key && Number(r.d) === i + 1)?.amount ?? 0);
      return run;
    });
  };
  const daily = {
    currentMonth: current, previousMonth: prevKey, today,
    daysInCurrent: lastDay(current), daysInPrevious: lastDay(prevKey),
    current: cumul(current, today), previous: cumul(prevKey, lastDay(prevKey)),
  };
  return { months, series, daily };
}

module.exports = { getTrends, clampMonths, MIN_MONTHS, MAX_MONTHS };
