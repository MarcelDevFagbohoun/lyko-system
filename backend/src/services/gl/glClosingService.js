'use strict';

const { ApiError } = require('../../middleware/error');

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

  await conn.query(
    "UPDATE gl_fiscal_years SET status = 'cloture', closed_at = NOW(), closed_by = :userId WHERE id = :id",
    { userId, id: fiscalYearId },
  );

  return { totalDebit, totalCredit };
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

module.exports = { cloturerExercice, computeTrialBalanceTotals, isLastPeriodOfFiscalYear };
