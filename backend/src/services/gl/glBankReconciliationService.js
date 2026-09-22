'use strict';

/**
 * Rapprochement bancaire (dernier des 6 points de complétude identifiés) —
 * compare le solde comptable du compte banque (521, seul compte banque de ce
 * système : virement/chèque y sont TOUJOURS résolus, voir
 * `TREASURY_BY_PAYMENT_METHOD` dans `db/seedGeneralLedger.js`) avec le solde
 * réel d'un relevé bancaire, saisi manuellement — aucune intégration
 * bancaire réelle. Tables `gl_bank_reconciliations`/`gl_bank_reconciliation_lines`
 * existaient déjà dans le schéma initial (migration 040) mais n'étaient
 * jamais branchées à aucune route — c'est ce module qui les active.
 *
 * Principe : au lieu de faire ressaisir CHAQUE ligne du relevé par
 * l'utilisateur (fastidieux, hors de portée pour un non-comptable), il
 * "pointe" directement les mouvements déjà enregistrés dans l'application
 * qui apparaissent sur son relevé papier — une seule action par mouvement.
 * Seules les opérations VUES SUR LE RELEVÉ mais ABSENTES des comptes (frais
 * bancaires, agios...) exigent une saisie manuelle complète : ce sont
 * justement celles qu'il faut repérer pour les enregistrer séparément
 * (jamais créées automatiquement ici — ce module ne fait QUE comparer).
 */

const { ApiError } = require('../../middleware/error');

const BANK_JOURNAL_CODE = 'BQ';
const BANK_ACCOUNT_CODE = '521';

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function lastDayOfPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Résout le journal ET le compte banque du tenant — lève 409 si le plan comptable n'a jamais été initialisé. */
async function getBankJournalAndAccount(conn, tenantId) {
  const [[journal]] = await conn.query('SELECT id FROM gl_journals WHERE tenant_id = :tenantId AND code = :code LIMIT 1', {
    tenantId,
    code: BANK_JOURNAL_CODE,
  });
  const [[account]] = await conn.query('SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = :code LIMIT 1', {
    tenantId,
    code: BANK_ACCOUNT_CODE,
  });
  if (!journal || !account) {
    throw new ApiError(409, "Le plan comptable n'est pas encore initialisé — activez d'abord la comptabilité avancée.");
  }
  return { journalId: journal.id, accountId: account.id };
}

/** Solde du compte banque (débit − crédit), cumulé depuis toujours jusqu'à `asOfDate` inclus. */
async function computeBookBalance(conn, tenantId, accountId, asOfDate) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE -el.amount END), 0) AS solde
     FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id
     WHERE e.tenant_id = :tenantId AND el.account_id = :accountId AND e.entry_date <= :asOfDate`,
    { tenantId, accountId, asOfDate },
  );
  return Number(row.solde);
}

function toPublicReconciliation(row) {
  const statementBalance = Number(row.statement_balance);
  const bookBalance = Number(row.book_balance);
  return {
    id: row.id,
    period: row.period,
    statementBalance,
    bookBalance,
    gap: statementBalance - bookBalance,
    status: row.status,
    reconciledAt: row.reconciled_at,
    createdAt: row.created_at,
  };
}

async function listReconciliations(pool, tenantId) {
  const [rows] = await pool.query('SELECT * FROM gl_bank_reconciliations WHERE tenant_id = :tenantId ORDER BY period DESC', {
    tenantId,
  });
  return rows.map(toPublicReconciliation);
}

async function startReconciliation(pool, tenantId, { period, statementBalance }) {
  const { journalId, accountId } = await getBankJournalAndAccount(pool, tenantId);

  const [existing] = await pool.query(
    'SELECT id FROM gl_bank_reconciliations WHERE tenant_id = :tenantId AND journal_id = :journalId AND period = :period LIMIT 1',
    { tenantId, journalId, period },
  );
  if (existing[0]) throw new ApiError(409, `Un rapprochement existe déjà pour ${period}.`);

  const asOfDate = lastDayOfPeriod(period);
  const bookBalance = await computeBookBalance(pool, tenantId, accountId, asOfDate);

  const [result] = await pool.query(
    `INSERT INTO gl_bank_reconciliations (tenant_id, journal_id, period, statement_balance, book_balance, status)
     VALUES (:tenantId, :journalId, :period, :statementBalance, :bookBalance, 'en_cours')`,
    { tenantId, journalId, period, statementBalance, bookBalance },
  );
  return { id: result.insertId };
}

/** Charge un rapprochement de l'entreprise courante, ou lève 404. */
async function loadReconciliation(conn, tenantId, id) {
  const [rows] = await conn.query('SELECT * FROM gl_bank_reconciliations WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
    id,
    tenantId,
  });
  if (!rows[0]) throw new ApiError(404, 'Rapprochement introuvable');
  return rows[0];
}

/** Mouvements comptables du compte banque jusqu'à la fin de la période, jamais encore pointés dans AUCUN rapprochement (passé ou courant). */
async function findUnmatchedBookMovements(conn, tenantId, accountId, asOfDate) {
  const [rows] = await conn.query(
    `SELECT el.id, e.entry_date, e.entry_number, e.narration, el.side, el.amount
     FROM gl_entry_lines el
     JOIN gl_entries e ON e.id = el.entry_id
     WHERE e.tenant_id = :tenantId AND el.account_id = :accountId AND e.entry_date <= :asOfDate
       AND el.id NOT IN (SELECT entry_line_id FROM gl_bank_reconciliation_lines WHERE entry_line_id IS NOT NULL)
     ORDER BY e.entry_date ASC, e.entry_number ASC`,
    { tenantId, accountId, asOfDate },
  );
  return rows.map((r) => ({
    entryLineId: r.id,
    entryDate: isoDate(r.entry_date),
    entryNumber: r.entry_number,
    narration: r.narration,
    side: r.side,
    amount: Number(r.amount),
  }));
}

/** Détail complet : le rapprochement, ses lignes déjà saisies, et les mouvements comptables pas encore pointés. */
async function getReconciliationDetail(pool, tenantId, id) {
  const reconciliation = await loadReconciliation(pool, tenantId, id);
  const { accountId } = await getBankJournalAndAccount(pool, tenantId);
  const asOfDate = lastDayOfPeriod(reconciliation.period);

  const [lineRows] = await pool.query(
    `SELECT brl.*, e.entry_date AS entry_line_date, e.narration AS entry_line_narration, el.side, el.amount AS entry_line_amount
     FROM gl_bank_reconciliation_lines brl
     LEFT JOIN gl_entry_lines el ON el.id = brl.entry_line_id
     LEFT JOIN gl_entries e ON e.id = el.entry_id
     WHERE brl.reconciliation_id = :id ORDER BY brl.bank_date ASC, brl.id ASC`,
    { id },
  );

  const unmatchedBookMovements = await findUnmatchedBookMovements(pool, tenantId, accountId, asOfDate);

  return {
    reconciliation: toPublicReconciliation(reconciliation),
    lines: lineRows.map((r) => ({
      id: r.id,
      isMatched: !!r.is_matched,
      bankReference: r.bank_reference,
      bankAmount: Number(r.bank_amount),
      bankDate: isoDate(r.bank_date),
      entryLine: r.entry_line_id
        ? {
            entryDate: isoDate(r.entry_line_date),
            narration: r.entry_line_narration,
            side: r.side,
            amount: Number(r.entry_line_amount),
          }
        : null,
    })),
    unmatchedBookMovements,
  };
}

/** Ajoute une ligne : soit pointe une écriture existante du compte banque, soit enregistre une opération vue seulement sur le relevé. */
async function addLine(pool, tenantId, reconciliationId, input, accountId) {
  const reconciliation = await loadReconciliation(pool, tenantId, reconciliationId);
  if (reconciliation.status !== 'en_cours') throw new ApiError(409, 'Ce rapprochement est déjà clôturé.');

  if (input.entryLineId) {
    const [rows] = await pool.query(
      `SELECT el.id, el.amount, e.entry_date FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id
       WHERE el.id = :id AND el.account_id = :accountId AND e.tenant_id = :tenantId LIMIT 1`,
      { id: input.entryLineId, accountId, tenantId },
    );
    if (!rows[0]) throw new ApiError(404, 'Mouvement comptable introuvable pour le compte banque.');

    const [already] = await pool.query('SELECT id FROM gl_bank_reconciliation_lines WHERE entry_line_id = :id LIMIT 1', {
      id: input.entryLineId,
    });
    if (already[0]) throw new ApiError(409, 'Ce mouvement est déjà pointé.');

    const [result] = await pool.query(
      `INSERT INTO gl_bank_reconciliation_lines (reconciliation_id, entry_line_id, bank_amount, bank_date, is_matched)
       VALUES (:reconciliationId, :entryLineId, :amount, :date, 1)`,
      { reconciliationId, entryLineId: input.entryLineId, amount: rows[0].amount, date: isoDate(rows[0].entry_date) },
    );
    return result.insertId;
  }

  const [result] = await pool.query(
    `INSERT INTO gl_bank_reconciliation_lines (reconciliation_id, bank_reference, bank_amount, bank_date, is_matched)
     VALUES (:reconciliationId, :bankReference, :bankAmount, :bankDate, 0)`,
    { reconciliationId, bankReference: input.bankReference ?? null, bankAmount: input.bankAmount, bankDate: input.bankDate },
  );
  return result.insertId;
}

/** Retire une ligne (annule un pointage, ou supprime une ligne bancaire saisie par erreur). */
async function removeLine(pool, tenantId, reconciliationId, lineId) {
  const reconciliation = await loadReconciliation(pool, tenantId, reconciliationId);
  if (reconciliation.status !== 'en_cours') throw new ApiError(409, 'Ce rapprochement est déjà clôturé.');

  const [result] = await pool.query(
    'DELETE FROM gl_bank_reconciliation_lines WHERE id = :lineId AND reconciliation_id = :reconciliationId',
    { lineId, reconciliationId },
  );
  if (result.affectedRows === 0) throw new ApiError(404, 'Ligne introuvable.');
}

async function updateStatementBalance(pool, tenantId, reconciliationId, statementBalance) {
  const reconciliation = await loadReconciliation(pool, tenantId, reconciliationId);
  if (reconciliation.status !== 'en_cours') throw new ApiError(409, 'Ce rapprochement est déjà clôturé.');

  await pool.query('UPDATE gl_bank_reconciliations SET statement_balance = :v WHERE id = :id', {
    v: statementBalance,
    id: reconciliationId,
  });
}

/**
 * Clôture définitive. Avertit (sans jamais bloquer, sauf confirmation
 * explicite via `force`) si des mouvements comptables restent non pointés ou
 * si l'écart (relevé − comptable) n'est pas nul — un écart peut être
 * légitime (frais bancaires pas encore saisis, chèque pas encore encaissé) :
 * à l'utilisateur de juger, jamais un blocage arbitraire du système.
 */
async function finalizeReconciliation(conn, tenantId, reconciliationId, { userId, force }) {
  const reconciliation = await loadReconciliation(conn, tenantId, reconciliationId);
  if (reconciliation.status !== 'en_cours') throw new ApiError(409, 'Ce rapprochement est déjà clôturé.');

  const { accountId } = await getBankJournalAndAccount(conn, tenantId);
  const asOfDate = lastDayOfPeriod(reconciliation.period);
  const unmatched = await findUnmatchedBookMovements(conn, tenantId, accountId, asOfDate);
  const gap = Number(reconciliation.statement_balance) - Number(reconciliation.book_balance);

  if (!force && (unmatched.length > 0 || gap !== 0)) {
    throw new ApiError(409, "Il reste des mouvements non pointés ou un écart entre le relevé et les comptes.", {
      unmatchedCount: unmatched.length,
      gap,
    });
  }

  await conn.query(
    "UPDATE gl_bank_reconciliations SET status = 'rapproche', reconciled_by = :userId, reconciled_at = NOW() WHERE id = :id",
    { userId, id: reconciliationId },
  );
}

module.exports = {
  BANK_JOURNAL_CODE,
  BANK_ACCOUNT_CODE,
  getBankJournalAndAccount,
  computeBookBalance,
  listReconciliations,
  startReconciliation,
  loadReconciliation,
  getReconciliationDetail,
  addLine,
  removeLine,
  updateStatementBalance,
  finalizeReconciliation,
};
