'use strict';

/**
 * Extourne (contre-passation) — SEULE façon de corriger une écriture
 * validée : jamais de modification ni de suppression directe (imposé aussi
 * au niveau des routes, voir routes/gl/glEntries.js — ceci est le filet de
 * sécurité côté service). Crée une NOUVELLE écriture miroir (lignes
 * inversées débit/crédit), toujours dans le même journal, datée du jour de
 * l'extourne (peut donc tomber dans un exercice différent de l'original —
 * c'est normal et volontaire).
 */

const { nextEntryNumber } = require('./glNumbering');
const { resolveOpenFiscalYear } = require('./glPostingService');

async function extourneEcriture(conn, { tenantId, entryId, entryDate, userId, reason }) {
  const [entryRows] = await conn.query('SELECT * FROM gl_entries WHERE id = :entryId AND tenant_id = :tenantId LIMIT 1', {
    entryId,
    tenantId,
  });
  const original = entryRows[0];
  if (!original) throw new Error('Écriture introuvable.');
  if (original.status === 'extournee') throw new Error('Cette écriture a déjà été extournée.');
  if (original.status === 'brouillon') throw new Error('Une écriture en brouillon se supprime, elle ne s\'extourne pas.');

  const [lines] = await conn.query('SELECT * FROM gl_entry_lines WHERE entry_id = :entryId ORDER BY line_order ASC', {
    entryId,
  });
  if (lines.length === 0) throw new Error('Écriture sans lignes — impossible à extourner.');

  const fiscalYearId = await resolveOpenFiscalYear(conn, tenantId, entryDate);
  const entryNumber = await nextEntryNumber(conn, tenantId);
  const narration = `Extourne de l'écriture n°${original.entry_number} — ${original.narration}${reason ? ` (${reason})` : ''}`;

  const [reversalResult] = await conn.query(
    `INSERT INTO gl_entries
       (tenant_id, journal_id, fiscal_year_id, entry_number, piece_number, entry_date, narration,
        source_operation_type, source_table, source_id, status, reverses_entry_id, created_by)
     VALUES
       (:tenantId, :journalId, :fiscalYearId, :entryNumber, :entryNumber, :entryDate, :narration,
        :operationType, :sourceTable, :sourceId, 'validee', :originalId, :userId)`,
    {
      tenantId,
      journalId: original.journal_id,
      fiscalYearId,
      entryNumber,
      entryDate,
      narration,
      operationType: original.source_operation_type,
      sourceTable: original.source_table,
      sourceId: original.source_id,
      originalId: original.id,
      userId,
    },
  );
  const reversalId = reversalResult.insertId;

  for (const line of lines) {
    await conn.query(
      `INSERT INTO gl_entry_lines (entry_id, line_order, account_id, third_party_id, side, amount, payment_method)
       VALUES (:entryId, :order, :accountId, :thirdPartyId, :side, :amount, :paymentMethod)`,
      {
        entryId: reversalId,
        order: line.line_order,
        accountId: line.account_id,
        thirdPartyId: line.third_party_id,
        side: line.side === 'debit' ? 'credit' : 'debit', // inversion — c'est tout le principe de l'extourne
        amount: line.amount,
        paymentMethod: line.payment_method,
      },
    );
  }

  await conn.query("UPDATE gl_entries SET status = 'extournee', reversed_by_entry_id = :reversalId WHERE id = :id", {
    reversalId,
    id: original.id,
  });

  return { reversalId, reversalEntryNumber: entryNumber, originalEntryId: original.id };
}

module.exports = { extourneEcriture };
