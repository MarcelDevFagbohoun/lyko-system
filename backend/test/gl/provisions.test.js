'use strict';

/**
 * Audit comptabilité avancée (point 7, 16/10/2026) : le plan comptable n'avait aucun compte de
 * provision pour créance douteuse (491/6594/7594/651), alors que l'application suit déjà les impayés
 * locataires en détail — un comptable clôturant un exercice n'avait littéralement aucun compte où
 * poser une telle provision. Provision volontairement GLOBALE en V1 (pas de sous-compte par
 * locataire) : se pose via une écriture manuelle (désormais possible sur n'importe quel compte, voir
 * le point 6 du même audit), jamais une règle automatique — le montant et le moment restent un
 * jugement comptable.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { nextEntryNumber } = require('../../src/services/gl/glNumbering');
const { computeIncomeStatement, computeBalanceSheet } = require('../../src/services/gl/glFinancialStatements');
const { createFixture, teardown } = require('./fixtures');

let fx;
let accountsByCode;

before(async () => {
  fx = await createFixture();
  const [rows] = await pool.query('SELECT code, id, class, account_type, is_control_account FROM gl_accounts WHERE tenant_id = :t', {
    t: fx.tenantId,
  });
  accountsByCode = new Map(rows.map((r) => [r.code, r]));
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('le plan comptable seedé inclut désormais 491/6594/7594/651, avec les bons sens et classes', () => {
  const depreciation = accountsByCode.get('491');
  assert.ok(depreciation, 'compte 491 absent du plan comptable seedé');
  assert.equal(depreciation.class, 4);
  assert.equal(depreciation.account_type, 'actif'); // soustractif — voir 284XX, même principe

  const dotation = accountsByCode.get('6594');
  assert.ok(dotation);
  assert.equal(dotation.class, 6);
  assert.equal(dotation.account_type, 'charge');

  const reprise = accountsByCode.get('7594');
  assert.ok(reprise);
  assert.equal(reprise.class, 7);
  assert.equal(reprise.account_type, 'produit');

  const perteIrrecouvrable = accountsByCode.get('651');
  assert.ok(perteIrrecouvrable);
  assert.equal(perteIrrecouvrable.class, 6);
  assert.equal(perteIrrecouvrable.account_type, 'charge');
});

test(
  "une provision (491/6594) posée via une écriture manuelle réduit bien le total actif du bilan " +
    "(compte SOUSTRACTIF) et apparaît comme charge au compte de résultat — jamais l'inverse",
  async () => {
    const dotationId = accountsByCode.get('6594').id;
    const depreciationId = accountsByCode.get('491').id;

    const before1 = await computeBalanceSheet(pool, fx.tenantId, fx.fiscalYearId);
    const actifAvant = before1.totalActif;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Même mécanique que `glEntries.js POST /manual` (2 lignes équilibrées), directement via le
      // moteur de bas niveau pour ne pas dépendre d'un `operationType` dédié — il n'y en a volontairement
      // aucun pour une provision (jugement comptable, jamais automatisé).
      const [journalRow] = await conn.query("SELECT id FROM gl_journals WHERE tenant_id = :t AND code = 'OD'", { t: fx.tenantId });
      const n = await nextEntryNumber(conn, fx.tenantId);
      const [entry] = await conn.query(
        `INSERT INTO gl_entries (tenant_id, journal_id, fiscal_year_id, entry_number, piece_number, entry_date, narration, status)
         VALUES (:t, :journalId, :fiscalYearId, :n, :n, '2026-06-15', 'Provision creance douteuse - test', 'validee')`,
        { t: fx.tenantId, journalId: journalRow[0].id, fiscalYearId: fx.fiscalYearId, n },
      );
      await conn.query(
        `INSERT INTO gl_entry_lines (entry_id, line_order, account_id, side, amount) VALUES
           (:entryId, 1, :dotationId, 'debit', 7000),
           (:entryId, 2, :depreciationId, 'credit', 7000)`,
        { entryId: entry.insertId, dotationId, depreciationId },
      );
      await conn.commit();
    } finally {
      conn.release();
    }

    const income = await computeIncomeStatement(pool, fx.tenantId, fx.fiscalYearId);
    assert.ok(income.charges.some((c) => c.code === '6594' && c.amount === 7000));

    const after1 = await computeBalanceSheet(pool, fx.tenantId, fx.fiscalYearId);
    const depreciationLine = after1.actif.find((a) => a.code === '491');
    assert.ok(depreciationLine, 'la ligne 491 doit apparaître côté actif (soustractive)');
    assert.equal(depreciationLine.amount, -7000, '491 est un compte crédité : (débit - crédit) doit être NÉGATIF');
    // Le total actif baisse de 7000 par rapport à avant la provision — jamais l'inverse.
    assert.equal(after1.totalActif, actifAvant - 7000);
  },
);
