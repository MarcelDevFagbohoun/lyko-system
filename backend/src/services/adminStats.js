'use strict';

/**
 * Tableau de bord du back-office : encaissements d'abonnement, évolution et comparaisons mensuelles, paiements non aboutis,
 * répartition des entreprises. Lecture seule, aucune donnée métier des clients.
 *
 * Règles de calcul (à garder alignées avec l'écran) :
 *  - un abonnement offert ou partenaire (0 FCFA) n'est jamais une recette ;
 *  - les mois et les jours sont ceux du Bénin (UTC+1, sans heure d'été) : la base stocke en UTC ;
 *  - « net » = encaissé − remboursé, le remboursement étant retiré du mois où il est versé ;
 *  - MRR (revenu mensuel récurrent) = pour chaque abonnement payant couvrant la fin du mois, (montant payé + crédit appliqué) / durée en mois.
 */
const { pool } = require('../config/db');

const MIN_MONTHS = 3;
const MAX_MONTHS = 24;
const PLANS = ['demarrage', 'pro', 'entreprise'];
const KINDS = ['purchase', 'renewal', 'upgrade'];

// Heure du Bénin à partir d'une colonne UTC.
const BJ = (col) => `DATE_ADD(${col}, INTERVAL 1 HOUR)`;
const BJ_NOW = BJ('UTC_TIMESTAMP()');
const THIS_MONTH = `DATE_FORMAT(${BJ_NOW}, '%Y-%m-01')`;
// Un paiement « en attente » depuis plus de 2 h est considéré comme non terminé (même seuil que « Paiements à surveiller »).
const STALE_PENDING = "(p.status = 'pending' AND p.created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR))";
const PAID = "p.status IN ('paid','refunded') AND p.amount > 0";
const LAST_30 = 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)';

function clampMonths(v) {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, n)) : 12;
}
const addMonths = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function getStats(monthsParam) {
  const months = clampMonths(monthsParam);
  const [[clock]] = await pool.query(
    `SELECT DATE_FORMAT(${BJ_NOW}, '%Y-%m') AS ym, DAY(${BJ_NOW}) AS today,
            DAY(LAST_DAY(${BJ_NOW})) AS days_cur, DAY(LAST_DAY(DATE_SUB(${BJ_NOW}, INTERVAL 1 MONTH))) AS days_prev`,
  );
  const current = clock.ym;
  const keys = Array.from({ length: months }, (_, i) => addMonths(current, i - months + 1));
  const from = `${keys[0]}-01`; // en heure du Bénin

  const [[sums]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN ${PAID} THEN p.amount END), 0) AS total_collected,
       COALESCE(SUM(CASE WHEN ${PAID} AND ${BJ('p.paid_at')} >= ${THIS_MONTH} THEN p.amount END), 0) AS month_collected,
       COALESCE(SUM(CASE WHEN ${PAID} AND ${BJ('p.paid_at')} >= DATE_SUB(${THIS_MONTH}, INTERVAL 1 MONTH) AND ${BJ('p.paid_at')} < ${THIS_MONTH} THEN p.amount END), 0) AS prev_month_collected,
       COALESCE(SUM(CASE WHEN ${PAID} AND p.paid_at >= ${LAST_30} THEN 1 END), 0) AS ok_30,
       COALESCE(SUM(CASE WHEN p.status = 'failed' AND p.created_at >= ${LAST_30} THEN 1 END), 0) AS failed_30,
       COALESCE(SUM(CASE WHEN ${STALE_PENDING} AND p.created_at >= ${LAST_30} THEN 1 END), 0) AS incomplete_30,
       COALESCE(SUM(CASE WHEN p.status = 'failed' AND p.created_at >= ${LAST_30} THEN p.amount END), 0) AS failed_amount_30,
       COALESCE(SUM(CASE WHEN p.status = 'anomaly' THEN 1 END), 0) AS anomalies,
       COALESCE(SUM(CASE WHEN p.status = 'anomaly' THEN p.amount END), 0) AS anomaly_amount
     FROM subscription_payments p`,
  );
  const [[refunded]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN refund_amount END), 0) AS total,
            COALESCE(SUM(CASE WHEN status = 'paid' AND ${BJ('paid_at')} >= ${THIS_MONTH} THEN refund_amount END), 0) AS this_month,
            COALESCE(SUM(CASE WHEN status IN ('requested','approved','details_received','processing','failed') THEN 1 END), 0) AS pending
     FROM subscription_refunds`,
  );

  // Encaissé par mois × offre × type, en une seule requête.
  const [paidRows] = await pool.query(
    `SELECT DATE_FORMAT(${BJ('p.paid_at')}, '%Y-%m') AS k, p.plan_key, p.kind, COUNT(*) AS n, SUM(p.amount) AS amount
     FROM subscription_payments p WHERE ${PAID} AND ${BJ('p.paid_at')} >= :from GROUP BY k, p.plan_key, p.kind`, { from },
  );
  const [refundRows] = await pool.query(
    `SELECT DATE_FORMAT(${BJ('paid_at')}, '%Y-%m') AS k, SUM(refund_amount) AS amount FROM subscription_refunds
     WHERE status = 'paid' AND ${BJ('paid_at')} >= :from GROUP BY k`, { from },
  );
  const [failedByMonth] = await pool.query(
    `SELECT DATE_FORMAT(${BJ('p.created_at')}, '%Y-%m') AS k, COUNT(*) AS n
     FROM subscription_payments p
     WHERE (p.status IN ('failed','anomaly') OR ${STALE_PENDING}) AND p.amount > 0 AND ${BJ('p.created_at')} >= :from GROUP BY k`, { from },
  );
  // MRR à la fin de chaque mois : abonnements payants qui couvrent ce moment-là (début = fin − durée, car les renouvellements n'ont pas de début stocké).
  const mrrSelects = keys.map((k, i) => `SELECT :k${i} AS k, COALESCE(SUM((p.amount + p.credit_applied) / p.months), 0) AS mrr
     FROM subscription_payments p
     WHERE p.status = 'paid' AND p.amount > 0 AND p.period_end IS NOT NULL
       AND ${BJ('DATE_SUB(p.period_end, INTERVAL p.months MONTH)')} < DATE_ADD(CONCAT(:k${i}, '-01'), INTERVAL 1 MONTH)
       AND ${BJ('p.period_end')} >= DATE_ADD(CONCAT(:k${i}, '-01'), INTERVAL 1 MONTH)
       AND (p.consumed_at IS NULL OR ${BJ('p.consumed_at')} >= DATE_ADD(CONCAT(:k${i}, '-01'), INTERVAL 1 MONTH))`).join(' UNION ALL ');
  const [mrrRows] = await pool.query(mrrSelects, Object.fromEntries(keys.map((k, i) => [`k${i}`, k])));

  const refundMap = new Map(refundRows.map((r) => [r.k, Number(r.amount)]));
  const failMap = new Map(failedByMonth.map((r) => [r.k, Number(r.n)]));
  const mrrMap = new Map(mrrRows.map((r) => [r.k, Math.round(Number(r.mrr))]));
  const series = keys.map((k) => {
    const rows = paidRows.filter((r) => r.k === k);
    const sum = (f) => rows.filter(f).reduce((a, r) => a + Number(r.amount), 0);
    const amount = sum(() => true);
    const refundedAmount = refundMap.get(k) ?? 0;
    return {
      month: k,
      amount,
      payments: rows.reduce((a, r) => a + Number(r.n), 0),
      failed: failMap.get(k) ?? 0,
      refunded: refundedAmount,
      net: amount - refundedAmount,
      mrr: mrrMap.get(k) ?? 0,
      byPlan: Object.fromEntries(PLANS.map((pl) => [pl, sum((r) => r.plan_key === pl)])),
      byKind: Object.fromEntries(KINDS.map((kd) => [kd, sum((r) => r.kind === kd)])),
    };
  });

  // Cumul jour par jour : mois en cours (jusqu'à aujourd'hui) contre mois précédent complet.
  const prevKey = addMonths(current, -1);
  const [dayRows] = await pool.query(
    `SELECT DATE_FORMAT(${BJ('p.paid_at')}, '%Y-%m') AS k, DAY(${BJ('p.paid_at')}) AS d, SUM(p.amount) AS amount
     FROM subscription_payments p WHERE ${PAID} AND ${BJ('p.paid_at')} >= :prev GROUP BY k, d`, { prev: `${prevKey}-01` },
  );
  const cumul = (key, days) => {
    let run = 0;
    return Array.from({ length: days }, (_, i) => {
      run += Number(dayRows.find((r) => r.k === key && Number(r.d) === i + 1)?.amount ?? 0);
      return run;
    });
  };
  const daily = {
    currentMonth: current,
    previousMonth: prevKey,
    today: Number(clock.today),
    daysInCurrent: Number(clock.days_cur),
    daysInPrevious: Number(clock.days_prev),
    current: cumul(current, Number(clock.today)),
    previous: cumul(prevKey, Number(clock.days_prev)),
  };

  const [byPlan] = await pool.query(
    `SELECT p.plan_key, COUNT(*) AS n, SUM(p.amount) AS amount FROM subscription_payments p
     WHERE ${PAID} AND ${BJ('p.paid_at')} >= :from GROUP BY p.plan_key ORDER BY amount DESC`, { from },
  );
  const [byKind] = await pool.query(
    `SELECT p.kind, COUNT(*) AS n, SUM(p.amount) AS amount FROM subscription_payments p
     WHERE ${PAID} AND ${BJ('p.paid_at')} >= :from GROUP BY p.kind`, { from },
  );
  const [failReasons] = await pool.query(
    `SELECT COALESCE(CASE WHEN p.status = 'anomaly' THEN 'anomaly' WHEN p.status = 'pending' THEN 'incomplete' ELSE p.failure_reason END, 'unknown') AS reason, COUNT(*) AS n
     FROM subscription_payments p
     WHERE (p.status IN ('failed','anomaly') OR ${STALE_PENDING}) AND p.amount > 0 AND p.created_at >= ${LAST_30}
     GROUP BY reason ORDER BY n DESC`,
  );

  const [[tenants]] = await pool.query(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(${BJ('t.created_at')} >= ${THIS_MONTH}), 0) AS new_this_month,
       COALESCE(SUM(s.plan_key = 'partenaire' AND s.status = 'active' AND s.current_period_end > UTC_TIMESTAMP()), 0) AS partners,
       COALESCE(SUM(s.plan_key IN ('demarrage','pro','entreprise') AND s.status = 'active' AND s.current_period_end > UTC_TIMESTAMP()), 0) AS paying,
       COALESCE(SUM(s.plan_key = 'interne' AND s.status = 'active'), 0) AS internal,
       COALESCE(SUM(s.plan_key IN ('demarrage','pro','entreprise','partenaire') AND (s.status <> 'active' OR s.current_period_end <= UTC_TIMESTAMP())), 0) AS expired,
       COALESCE(SUM(s.plan_key IN ('demarrage','pro','entreprise') AND s.status = 'active' AND s.current_period_end > UTC_TIMESTAMP() AND s.current_period_end <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 14 DAY)), 0) AS expiring_14
     FROM tenants t LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id`,
  );
  const [plans] = await pool.query(
    `SELECT s.plan_key, COUNT(*) AS n FROM tenant_subscriptions s
     WHERE s.status = 'active' AND (s.plan_key = 'interne' OR s.current_period_end > UTC_TIMESTAMP()) GROUP BY s.plan_key`,
  );

  const [recent] = await pool.query(
    `SELECT p.id, p.status, p.failure_reason, p.plan_key, p.months, p.kind, p.amount, p.created_at, p.paid_at, t.company_name
     FROM subscription_payments p JOIN tenants t ON t.id = p.tenant_id
     WHERE p.amount > 0 ORDER BY p.id DESC LIMIT 10`,
  );

  const attempts = Number(sums.ok_30) + Number(sums.failed_30) + Number(sums.incomplete_30);
  return {
    months,
    kpis: {
      collectedTotal: Number(sums.total_collected),
      collectedMonth: Number(sums.month_collected),
      collectedPrevMonth: Number(sums.prev_month_collected),
      refundedTotal: Number(refunded.total),
      refundedMonth: Number(refunded.this_month),
      refundsPending: Number(refunded.pending),
      mrr: series[series.length - 1].mrr,
      mrrPrevious: series.length > 1 ? series[series.length - 2].mrr : 0,
      success30: Number(sums.ok_30),
      failed30: Number(sums.failed_30),
      incomplete30: Number(sums.incomplete_30),
      failedAmount30: Number(sums.failed_amount_30),
      successRate30: attempts ? Math.round((Number(sums.ok_30) / attempts) * 100) : null,
      anomalies: Number(sums.anomalies),
      anomalyAmount: Number(sums.anomaly_amount),
    },
    series,
    daily,
    byPlan: byPlan.map((r) => ({ planKey: r.plan_key, payments: Number(r.n), amount: Number(r.amount) })),
    byKind: byKind.map((r) => ({ kind: r.kind, payments: Number(r.n), amount: Number(r.amount) })),
    failureReasons: failReasons.map((r) => ({ reason: r.reason, count: Number(r.n) })),
    tenants: {
      total: Number(tenants.total), newThisMonth: Number(tenants.new_this_month), paying: Number(tenants.paying), partners: Number(tenants.partners),
      internal: Number(tenants.internal), expired: Number(tenants.expired), expiring14: Number(tenants.expiring_14),
    },
    plans: plans.map((r) => ({ planKey: r.plan_key, count: Number(r.n) })),
    recent: recent.map((r) => ({ id: r.id, status: r.status, reason: r.failure_reason, planKey: r.plan_key, months: r.months, kind: r.kind, amount: r.amount, createdAt: r.created_at, paidAt: r.paid_at, companyName: r.company_name })),
  };
}

module.exports = { getStats, clampMonths, MIN_MONTHS, MAX_MONTHS };
