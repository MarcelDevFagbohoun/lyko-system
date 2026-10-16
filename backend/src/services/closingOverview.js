'use strict';

/**
 * Vue d'ensemble de la clôture des mois (étape 54, demande de l'utilisateur : « que la clôture soit
 * facile et claire à utiliser »). Une seule source de vérité pour :
 *  - le PROCHAIN mois à clôturer (les mois se clôturent dans l'ordre, sans trou — voir la continuité
 *    vérifiée par `POST /api/accounting/periods`) ;
 *  - la frise des mois (clôturé, prêt, en attente, en cours…) ;
 *  - la liste de vérifications affichée avant de clôturer.
 * Aucune nouvelle règle métier : tout est lu depuis les calculs existants (clôturabilité, loyers du
 * mois, relevés SONEB/SBEE, dépenses). Utilisé par la page Clôture, les tâches et le rappel du DG.
 */

const { pool } = require('../config/db');
const { getOpenPeriodStart, getPeriodClosability, getAccountingStartDate } = require('./accountingPeriods');
const { computeRentMonthSummary } = require('./rentTracking');
const { findEarliestOperationDate } = require('./gl/glActivationService');

/** 'AAAA-MM' décalé de `n` mois. */
function shiftMonth(yearMonth, n) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastDayOf(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * Prochain mois à clôturer ('AAAA-MM') : celui qui suit la dernière clôture ; à défaut, le mois de la
 * date de démarrage de la comptabilité ; à défaut, le mois de la toute première opération
 * financière enregistrée. `null` si l'entreprise n'a encore rien enregistré (rien à clôturer).
 */
async function getNextMonthToClose(tenantId) {
  const openStart = await getOpenPeriodStart(pool, tenantId);
  if (openStart) return openStart.slice(0, 7);
  const earliest = await findEarliestOperationDate(pool, tenantId);
  return earliest ? earliest.slice(0, 7) : null;
}

/** Relevés SONEB/SBEE encore en brouillon dont la période touche ce mois. */
async function listDraftBatchesForMonth(tenantId, month) {
  const [rows] = await pool.query(
    `SELECT ub.id, ub.utility_type, ub.period_start, ub.period_end, p.code AS property_code
     FROM utility_reading_batches ub
     JOIN properties p ON p.id = ub.property_id
     WHERE ub.tenant_id = :tenantId AND ub.status = 'brouillon'
       AND ub.period_start <= :lastDay AND ub.period_end >= :firstDay
     ORDER BY ub.period_start ASC`,
    { tenantId, firstDay: `${month}-01`, lastDay: lastDayOf(month) },
  );
  return rows.map((r) => ({
    id: r.id,
    utilityType: r.utility_type,
    periodStart: isoDate(r.period_start),
    periodEnd: isoDate(r.period_end),
    propertyCode: r.property_code,
  }));
}

/** Dépenses du mois sans justificatif joint (nombre et total). */
async function countExpensesWithoutReceipt(tenantId, month) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM expenses
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND receipt_path IS NULL
       AND expense_date BETWEEN :firstDay AND :lastDay`,
    { tenantId, firstDay: `${month}-01`, lastDay: lastDayOf(month) },
  );
  return { count: Number(row.n), total: Number(row.total) };
}

/**
 * Liste de vérifications avant de clôturer `month`. Statuts : 'ok', 'attention' (prévient sans
 * bloquer : un impayé peut se régler après la clôture, sur un mois ouvert) ou 'bloquant' (seule la
 * marge de sécurité sur les échéances — outrepassable par une clôture forcée, tracée).
 */
async function buildChecklist(tenantId, month, closability) {
  const [rent, drafts, receipts] = await Promise.all([
    computeRentMonthSummary(tenantId, month),
    listDraftBatchesForMonth(tenantId, month),
    countExpensesWithoutReceipt(tenantId, month),
  ]);
  return [
    {
      key: 'echeances',
      status: closability.isClosable ? 'ok' : 'bloquant',
      closableFrom: closability.closableFrom,
      pendingLeases: closability.pendingLeases,
    },
    {
      key: 'loyers',
      status: rent.remaining > 0 ? 'attention' : 'ok',
      expected: rent.expected,
      collected: rent.collected,
      remaining: rent.remaining,
      lateRemaining: rent.lateRemaining,
      unpaidLeases: rent.counts.partiel + rent.counts.en_retard + rent.counts.a_payer,
    },
    { key: 'releves', status: drafts.length > 0 ? 'attention' : 'ok', batches: drafts },
    { key: 'justificatifs', status: receipts.count > 0 ? 'attention' : 'ok', ...receipts },
  ];
}

/**
 * Vue complète pour la page Clôture. `months` : frise des mois, du plus ancien au mois en cours
 * (12 mois, élargie si le prochain mois à clôturer est plus ancien, 24 mois au plus).
 */
async function getClosingOverview(tenantId, today = new Date()) {
  const todayIso = today.toISOString().slice(0, 10);
  const currentMonth = todayIso.slice(0, 7);
  const [nextMonth, accountingStartDate, [closedRows]] = await Promise.all([
    getNextMonthToClose(tenantId),
    getAccountingStartDate(tenantId),
    pool.query(
      `SELECT period, period_start, period_end, forced FROM accounting_periods WHERE tenant_id = :tenantId`,
      { tenantId },
    ),
  ]);

  const closed = closedRows.map((r) => ({
    from: isoDate(r.period_start).slice(0, 7),
    to: isoDate(r.period_end).slice(0, 7),
    forced: !!r.forced,
  }));
  const closedInfo = (ym) => closed.find((c) => c.from <= ym && ym <= c.to) ?? null;

  let first = shiftMonth(currentMonth, -11);
  if (nextMonth && nextMonth < first) first = nextMonth < shiftMonth(currentMonth, -23) ? shiftMonth(currentMonth, -23) : shiftMonth(nextMonth, -1);

  // Seul le prochain mois à clôturer (s'il n'est pas dans le futur) a besoin du calcul complet.
  const nextIsActionable = !!nextMonth && nextMonth <= currentMonth;
  const closability = nextIsActionable ? await getPeriodClosability(tenantId, nextMonth) : null;

  const months = [];
  for (let ym = first; ym <= currentMonth; ym = shiftMonth(ym, 1)) {
    const c = closedInfo(ym);
    let status;
    if (c) status = 'cloture';
    else if (nextMonth && ym < nextMonth) status = 'hors_suivi';
    else if (ym === nextMonth && ym !== currentMonth) status = closability.isClosable ? 'pret' : 'en_attente';
    else if (ym === currentMonth) status = 'en_cours';
    else status = 'a_suivre';
    months.push({
      month: ym,
      status,
      forced: c?.forced ?? false,
      closableFrom: ym === nextMonth && closability ? closability.closableFrom : null,
    });
  }

  return {
    currentMonth,
    nextMonth,
    accountingStartDate,
    months,
    next: nextIsActionable
      ? {
          month: nextMonth,
          isCurrentMonth: nextMonth === currentMonth,
          isClosable: closability.isClosable,
          closableFrom: closability.closableFrom,
          checks: await buildChecklist(tenantId, nextMonth, closability),
        }
      : null,
  };
}

module.exports = { getNextMonthToClose, getClosingOverview, shiftMonth };
