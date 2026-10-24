'use strict';

const { ApiError } = require('../../middleware/error');
const { nextEntryNumber } = require('./glNumbering');

const CLOSING_OPERATION_TYPE = 'cloture_resultat';

/**
 * Clôture d'exercice — verrouille DÉFINITIVEMENT la période (pas de
 * réouverture, cohérent avec la clôture mensuelle existante,
 * `accounting_periods`, migration 015 : « une clôture est un acte
 * définitif »). Après clôture, `genererEcriture`/`extourneEcriture` refusent
 * toute nouvelle écriture datée dans cet exercice (voir
 * `resolveOpenFiscalYear`, glPostingService.js).
 */

async function computeTrialBalanceTotals(conn, tenantId, fiscalYearId) {
  const [[totals]] = await conn.query(
    `SELECT
       COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE 0 END), 0) AS total_debit,
       COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE 0 END), 0) AS total_credit
     FROM gl_entry_lines el
     JOIN gl_entries e ON e.id = el.entry_id
     WHERE e.tenant_id = :tenantId AND e.fiscal_year_id = :fiscalYearId`,
    { tenantId, fiscalYearId },
  );
  return { totalDebit: Number(totals.total_debit), totalCredit: Number(totals.total_credit) };
}

/**
 * Soldes de gestion (classes 6/7/8) de l'exercice, hors éventuelle écriture de
 * clôture déjà passée. `resultat` > 0 = bénéfice, < 0 = perte.
 */
async function computeClosingBalances(conn, tenantId, fiscalYearId) {
  const [rows] = await conn.query(
    `SELECT a.id, a.code, a.account_type,
            COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE 0 END), 0) AS d,
            COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE 0 END), 0) AS c
       FROM gl_accounts a
       JOIN gl_entry_lines el ON el.account_id = a.id
       JOIN gl_entries e ON e.id = el.entry_id
      WHERE a.tenant_id = :tenantId AND e.fiscal_year_id = :fiscalYearId AND a.class IN (6, 7, 8)
        AND (e.source_operation_type IS NULL OR e.source_operation_type <> '${CLOSING_OPERATION_TYPE}')
      GROUP BY a.id, a.code, a.account_type
     HAVING d <> c`,
    { tenantId, fiscalYearId },
  );
  const lines = rows.map((r) => ({ accountId: r.id, code: r.code, net: Number(r.c) - Number(r.d) })); // >0 = solde créditeur
  const resultat = lines.reduce((s, l) => s + l.net, 0);
  return { lines, resultat };
}

/**
 * Clôture COMPLÈTE : solde chaque compte de gestion (6/7/8) et inscrit le résultat net dans les capitaux
 * propres — 121 si bénéfice, 129 si perte — à la date de fin d'exercice, dans la même transaction que
 * le verrouillage. Les soldes de bilan se reportent d'eux-mêmes (les états financiers sont cumulatifs
 * depuis l'origine), d'où l'absence d'écritures d'à-nouveaux distinctes : le « report à nouveau » est
 * visible dans la balance d'ouverture de l'exercice suivant (`getOpeningBalances`).
 */
async function postClosingEntry(conn, { tenantId, fiscalYear, userId }) {
  const { lines, resultat } = await computeClosingBalances(conn, tenantId, fiscalYear.id);
  if (lines.length === 0) return null;

  const [accRows] = await conn.query("SELECT id, code FROM gl_accounts WHERE tenant_id = :tenantId AND code IN ('121', '129')", { tenantId });
  const resultAccount = accRows.find((a) => a.code === (resultat >= 0 ? '121' : '129'));
  if (!resultAccount) throw new ApiError(409, "Comptes de résultat 121/129 absents du plan comptable — synchronisez le plan (Règles comptables).");
  const [[journal]] = await conn.query("SELECT id FROM gl_journals WHERE tenant_id = :tenantId AND code = 'OD' LIMIT 1", { tenantId });
  if (!journal) throw new ApiError(409, "Journal OD absent du plan comptable.");

  const entryDate = fiscalYear.end_date instanceof Date ? fiscalYear.end_date.toISOString().slice(0, 10) : String(fiscalYear.end_date).slice(0, 10);
  const entryNumber = await nextEntryNumber(conn, tenantId);
  const [res] = await conn.query(
    `INSERT INTO gl_entries (tenant_id, journal_id, fiscal_year_id, entry_number, piece_number, entry_date, narration,
                             source_operation_type, status, created_by)
     VALUES (:tenantId, :journalId, :fyId, :entryNumber, :entryNumber, :entryDate, :narration, :op, 'validee', :userId)`,
    {
      tenantId, journalId: journal.id, fyId: fiscalYear.id, entryNumber, entryDate, userId,
      narration: `Clôture ${fiscalYear.label} — affectation du résultat (${resultat >= 0 ? 'bénéfice' : 'perte'})`,
      op: CLOSING_OPERATION_TYPE,
    },
  );
  const entryId = res.insertId;
  let order = 1;
  const insert = (accountId, side, amount) =>
    conn.query(
      'INSERT INTO gl_entry_lines (entry_id, line_order, account_id, third_party_id, side, amount, payment_method) VALUES (:entryId, :order, :accountId, NULL, :side, :amount, NULL)',
      { entryId, order: order++, accountId, side, amount },
    );
  for (const l of lines) await insert(l.accountId, l.net > 0 ? 'debit' : 'credit', Math.abs(l.net));
  if (resultat !== 0) await insert(resultAccount.id, resultat > 0 ? 'credit' : 'debit', Math.abs(resultat));
  return { entryId, resultat };
}

async function cloturerExercice(conn, { tenantId, fiscalYearId, userId }) {
  const [rows] = await conn.query('SELECT * FROM gl_fiscal_years WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
    id: fiscalYearId,
    tenantId,
  });
  const fiscalYear = rows[0];
  if (!fiscalYear) throw new ApiError(404, 'Exercice comptable introuvable.');
  if (fiscalYear.status === 'cloture') throw new ApiError(409, 'Cet exercice est déjà clôturé.');

  // Garde-fou avant clôture définitive : la balance de CET exercice doit être
  // équilibrée (elle DEVRAIT toujours l'être, chaque écriture individuelle
  // étant déjà vérifiée à l'insertion — cette vérification globale est une
  // dernière protection contre une anomalie, ex. une donnée corrompue par un
  // accès direct à la base hors de l'application).
  const { totalDebit, totalCredit } = await computeTrialBalanceTotals(conn, tenantId, fiscalYearId);
  if (totalDebit !== totalCredit) {
    throw new Error(
      `Impossible de clôturer : la balance de l'exercice est déséquilibrée (débit ${totalDebit} ≠ crédit ${totalCredit}). Contactez le support technique — ceci ne devrait jamais arriver.`,
    );
  }

  const [[tenantRow]] = await conn.query('SELECT gl_closing_mode FROM tenants WHERE id = :tenantId', { tenantId });
  let closingEntry = null;
  if (tenantRow?.gl_closing_mode === 'complet') {
    closingEntry = await postClosingEntry(conn, { tenantId, fiscalYear, userId });
  }

  await conn.query(
    "UPDATE gl_fiscal_years SET status = 'cloture', closed_at = NOW(), closed_by = :userId WHERE id = :id",
    { userId, id: fiscalYearId },
  );

  const after = await computeTrialBalanceTotals(conn, tenantId, fiscalYearId);
  return {
    totalDebit: after.totalDebit,
    totalCredit: after.totalCredit,
    closingEntryId: closingEntry?.entryId ?? null,
    resultat: closingEntry?.resultat ?? null,
  };
}

/** Aperçu avant clôture : résultat de l'exercice et traitement prévu. */
async function previewClosing(conn, tenantId, fiscalYearId) {
  const [[fy]] = await conn.query('SELECT id FROM gl_fiscal_years WHERE id = :id AND tenant_id = :tenantId', { id: fiscalYearId, tenantId });
  if (!fy) throw new ApiError(404, 'Exercice comptable introuvable.');
  const [[tenantRow]] = await conn.query('SELECT gl_closing_mode FROM tenants WHERE id = :tenantId', { tenantId });
  const { resultat, lines } = await computeClosingBalances(conn, tenantId, fiscalYearId);
  return { mode: tenantRow.gl_closing_mode, resultat, accountsToClose: lines.length, destinationAccount: resultat >= 0 ? '121' : '129' };
}

/** Balance d'ouverture d'un exercice = soldes de bilan (classes 1 à 5) à la veille de son début. */
async function getOpeningBalances(conn, tenantId, fiscalYearId) {
  const [[fy]] = await conn.query('SELECT start_date FROM gl_fiscal_years WHERE id = :id AND tenant_id = :tenantId', { id: fiscalYearId, tenantId });
  if (!fy) throw new ApiError(404, 'Exercice comptable introuvable.');
  const [rows] = await conn.query(
    `SELECT a.code, a.label, a.class,
            COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE -el.amount END), 0) AS solde
       FROM gl_accounts a
       JOIN gl_entry_lines el ON el.account_id = a.id
       JOIN gl_entries e ON e.id = el.entry_id
      WHERE a.tenant_id = :tenantId AND a.class BETWEEN 1 AND 5 AND e.entry_date < :start
      GROUP BY a.id, a.code, a.label, a.class HAVING solde <> 0 ORDER BY a.code`,
    { tenantId, start: fy.start_date },
  );
  const items = rows.map((r) => ({ code: r.code, label: r.label, debit: Number(r.solde) > 0 ? Number(r.solde) : 0, credit: Number(r.solde) < 0 ? -Number(r.solde) : 0 }));
  // Résultat des exercices antérieurs pas encore affecté (clôture simple ou exercice non clôturé) : sans cette
  // ligne, la balance d'ouverture ne s'équilibrerait pas.
  const [[pl]] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS resultat
       FROM gl_accounts a JOIN gl_entry_lines el ON el.account_id = a.id JOIN gl_entries e ON e.id = el.entry_id
      WHERE a.tenant_id = :tenantId AND a.class IN (6, 7, 8) AND e.entry_date < :start`,
    { tenantId, start: fy.start_date },
  );
  const unassigned = Number(pl.resultat);
  if (unassigned !== 0) {
    items.push({
      code: '—',
      label: 'Résultat des exercices précédents non encore affecté',
      debit: unassigned < 0 ? -unassigned : 0,
      credit: unassigned > 0 ? unassigned : 0,
    });
  }
  return items;
}

/**
 * Refonte de la clôture (étape 1/5, 2026-10-16) : emboîtement décidé par l'utilisateur entre la
 * nouvelle clôture (période ~mensuelle, configurable) et l'exercice SYSCOHADA (toujours annuel) —
 * les deux restent des tables distinctes, mais clôturer la DERNIÈRE période d'un exercice encore
 * ouvert doit pouvoir proposer (jamais forcer) de clôturer l'exercice dans le même geste perçu par
 * l'utilisateur comme « une seule clôture ». Vrai seulement quand `periodEnd` atteint ou dépasse la
 * fin de l'exercice — pas avant.
 */
async function isLastPeriodOfFiscalYear(conn, tenantId, fiscalYearId, periodEnd) {
  const [[fiscalYear]] = await conn.query(
    'SELECT end_date FROM gl_fiscal_years WHERE id = :fiscalYearId AND tenant_id = :tenantId LIMIT 1',
    { fiscalYearId, tenantId },
  );
  if (!fiscalYear) return false;
  const endDate = fiscalYear.end_date instanceof Date ? fiscalYear.end_date.toISOString().slice(0, 10) : String(fiscalYear.end_date).slice(0, 10);
  return endDate <= periodEnd;
}

module.exports = { CLOSING_OPERATION_TYPE, previewClosing, getOpeningBalances, computeClosingBalances, cloturerExercice, computeTrialBalanceTotals, isLastPeriodOfFiscalYear };
