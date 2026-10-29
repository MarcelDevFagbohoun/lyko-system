'use strict';

/**
 * Tableau de bord du back-office : encaissements d'abonnement, évolution mensuelle, paiements non aboutis, répartition des
 * entreprises. Lecture seule, aucune donnée métier des clients. Un abonnement offert (montant 0) n'est jamais compté comme recette.
 */
const { pool } = require('../config/db');

const MIN_MONTHS = 3;
const MAX_MONTHS = 24;
// Un paiement « en attente » depuis plus de 2 h est considéré comme non terminé (même seuil que « Paiements à surveiller »).
const STALE_PENDING = "(p.status = 'pending' AND p.created_at <= DATE_SUB(NOW(), INTERVAL 2 HOUR))";
const PAID = "p.status IN ('paid','refunded') AND p.amount > 0";

function clampMonths(v) {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, n)) : 12;
}

/** Liste des mois « AAAA-MM » de (now - n + 1) à now, d'après l'horloge de la base pour rester cohérent avec les requêtes. */
async function monthKeys(n) {
  const keys = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const [[r]] = await pool.query("SELECT DATE_FORMAT(DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL :i MONTH), '%Y-%m') AS k", { i });
    keys.push(r.k);
  }
  return keys;
}

async function getStats(monthsParam) {
  const months = clampMonths(monthsParam);
  const keys = await monthKeys(months);
  const from = `${keys[0]}-01`;

  const [[sums]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN ${PAID} THEN p.amount END), 0) AS total_collected,
       COALESCE(SUM(CASE WHEN ${PAID} AND p.paid_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN p.amount END), 0) AS month_collected,
       COALESCE(SUM(CASE WHEN ${PAID} AND p.paid_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 MONTH) AND p.paid_at < DATE_FORMAT(NOW(), '%Y-%m-01') THEN p.amount END), 0) AS prev_month_collected,
       COALESCE(SUM(CASE WHEN ${PAID} AND p.paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END), 0) AS ok_30,
       COALESCE(SUM(CASE WHEN p.status = 'failed' AND p.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END), 0) AS failed_30,
       COALESCE(SUM(CASE WHEN ${STALE_PENDING} AND p.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END), 0) AS incomplete_30,
       COALESCE(SUM(CASE WHEN p.status = 'failed' AND p.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN p.amount END), 0) AS failed_amount_30,
       COALESCE(SUM(CASE WHEN p.status = 'anomaly' THEN 1 END), 0) AS anomalies,
       COALESCE(SUM(CASE WHEN p.status = 'anomaly' THEN p.amount END), 0) AS anomaly_amount
     FROM subscription_payments p`,
  );
  const [[refunded]] = await pool.query(
    `SELECT COALESCE(SUM(refund_amount), 0) AS total,
            COALESCE(SUM(CASE WHEN paid_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN refund_amount END), 0) AS this_month,
            COALESCE(SUM(CASE WHEN status IN ('requested','approved','details_received','processing','failed') THEN 1 END), 0) AS pending
     FROM subscription_refunds WHERE status IN ('paid','requested','approved','details_received','processing','failed')`,
  );

  const [byMonth] = await pool.query(
    `SELECT DATE_FORMAT(p.paid_at, '%Y-%m') AS k, COUNT(*) AS n, SUM(p.amount) AS amount
     FROM subscription_payments p WHERE ${PAID} AND p.paid_at >= :from GROUP BY k`, { from },
  );
  const [failedByMonth] = await pool.query(
    `SELECT DATE_FORMAT(p.created_at, '%Y-%m') AS k, COUNT(*) AS n
     FROM subscription_payments p
     WHERE (p.status IN ('failed','anomaly') OR ${STALE_PENDING}) AND p.amount > 0 AND p.created_at >= :from GROUP BY k`, { from },
  );
  const paidMap = new Map(byMonth.map((r) => [r.k, r]));
  const failMap = new Map(failedByMonth.map((r) => [r.k, Number(r.n)]));
  const series = keys.map((k) => ({ month: k, amount: Number(paidMap.get(k)?.amount ?? 0), payments: Number(paidMap.get(k)?.n ?? 0), failed: failMap.get(k) ?? 0 }));

  const [byPlan] = await pool.query(
    `SELECT p.plan_key, COUNT(*) AS n, SUM(p.amount) AS amount FROM subscription_payments p
     WHERE ${PAID} AND p.paid_at >= :from GROUP BY p.plan_key ORDER BY amount DESC`, { from },
  );
  const [byKind] = await pool.query(
    `SELECT p.kind, COUNT(*) AS n, SUM(p.amount) AS amount FROM subscription_payments p
     WHERE ${PAID} AND p.paid_at >= :from GROUP BY p.kind`, { from },
  );
  const [failReasons] = await pool.query(
    `SELECT COALESCE(CASE WHEN p.status = 'anomaly' THEN 'anomaly' WHEN p.status = 'pending' THEN 'incomplete' ELSE p.failure_reason END, 'unknown') AS reason, COUNT(*) AS n
     FROM subscription_payments p
     WHERE (p.status IN ('failed','anomaly') OR ${STALE_PENDING}) AND p.amount > 0 AND p.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY reason ORDER BY n DESC`,
  );

  const [[tenants]] = await pool.query(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(t.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')), 0) AS new_this_month,
       COALESCE(SUM(s.plan_key = 'partenaire' AND s.status = 'active' AND s.current_period_end > NOW()), 0) AS partners,
       COALESCE(SUM(s.plan_key IN ('demarrage','pro','entreprise') AND s.status = 'active' AND s.current_period_end > NOW()), 0) AS paying,
       COALESCE(SUM(s.plan_key = 'interne' AND s.status = 'active'), 0) AS internal,
       COALESCE(SUM(s.plan_key IN ('demarrage','pro','entreprise','partenaire') AND (s.status <> 'active' OR s.current_period_end <= NOW())), 0) AS expired,
       COALESCE(SUM(s.plan_key IN ('demarrage','pro','entreprise') AND s.status = 'active' AND s.current_period_end > NOW() AND s.current_period_end <= DATE_ADD(NOW(), INTERVAL 14 DAY)), 0) AS expiring_14
     FROM tenants t LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id`,
  );
  const [plans] = await pool.query(
    `SELECT s.plan_key, COUNT(*) AS n FROM tenant_subscriptions s
     WHERE s.status = 'active' AND (s.plan_key = 'interne' OR s.current_period_end > NOW()) GROUP BY s.plan_key`,
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
      success30: Number(sums.ok_30),
      failed30: Number(sums.failed_30),
      incomplete30: Number(sums.incomplete_30),
      failedAmount30: Number(sums.failed_amount_30),
      successRate30: attempts ? Math.round((Number(sums.ok_30) / attempts) * 100) : null,
      anomalies: Number(sums.anomalies),
      anomalyAmount: Number(sums.anomaly_amount),
    },
    series,
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
