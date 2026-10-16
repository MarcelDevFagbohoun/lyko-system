'use strict';

/**
 * Audit comptabilité avancée (point 8, 16/10/2026) : l'équilibre débit = crédit n'est garanti qu'en
 * code applicatif (`genererEcriture` refuse toute écriture déséquilibrée à l'insertion), jamais au
 * niveau de la base elle-même — MySQL ne permet pas de CHECK portant sur une somme multi-lignes. Le
 * seul filet de sécurité contre un accès direct à la base (script, correctif manuel) qui créerait un
 * déséquilibre est ce job planifié (`balanceAlertJob`, 06h00 chaque jour) — jusqu'ici jamais testé.
 * Ce test prouve qu'il détecte vraiment un déséquilibre injecté directement en base (hors de
 * `genererEcriture`), exactement le scénario qu'il est censé couvrir.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { runBalanceAlertJob } = require('../../src/jobs/balanceAlertJob');
const { nextEntryNumber } = require('../../src/services/gl/glNumbering');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
  // `createFixture` seed le plan comptable mais n'active PAS le module — `isModuleActive` (vérifié par
  // ce job avant toute chose) retournerait sinon faux et court-circuiterait silencieusement le test.
  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: fx.tenantId });
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

async function notificationsOf(tenantId) {
  const [rows] = await pool.query(
    "SELECT message FROM gl_notifications WHERE tenant_id = :t AND type = 'balance_imbalance_alert'",
    { t: tenantId },
  );
  return rows;
}

beforeEach(async () => {
  await pool.query("DELETE FROM gl_notifications WHERE tenant_id = :t AND type = 'balance_imbalance_alert'", { t: fx.tenantId });
});

test("un exercice équilibré (aucune écriture) ne déclenche aucune alerte", async () => {
  await runBalanceAlertJob({ tenantIds: [fx.tenantId] });
  assert.deepEqual(await notificationsOf(fx.tenantId), []);
});

test(
  "un déséquilibre injecté DIRECTEMENT en base (hors `genererEcriture`, le scénario visé par ce job) " +
    "est bien détecté et notifié au DG",
  async () => {
    const [[account]] = await pool.query("SELECT id FROM gl_accounts WHERE tenant_id = :t AND code = '571'", { t: fx.tenantId });
    const [[journal]] = await pool.query("SELECT id FROM gl_journals WHERE tenant_id = :t AND code = 'OD'", { t: fx.tenantId });

    const conn = await pool.getConnection();
    let entryId;
    try {
      await conn.beginTransaction();
      const n = await nextEntryNumber(conn, fx.tenantId);
      const [entry] = await conn.query(
        `INSERT INTO gl_entries (tenant_id, journal_id, fiscal_year_id, entry_number, piece_number, entry_date, narration, status)
         VALUES (:t, :journalId, :fiscalYearId, :n, :n, '2026-05-01', 'Deliberement desequilibree - test point 8', 'validee')`,
        { t: fx.tenantId, journalId: journal.id, fiscalYearId: fx.fiscalYearId, n },
      );
      entryId = entry.insertId;
      // UNE SEULE ligne, sans contrepartie — exactement ce que `genererEcriture` refuse de faire, mais
      // qu'un accès SQL direct, lui, ne connaît pas.
      await conn.query(
        `INSERT INTO gl_entry_lines (entry_id, line_order, account_id, side, amount) VALUES (:entryId, 1, :accountId, 'debit', 15000)`,
        { entryId, accountId: account.id },
      );
      await conn.commit();
    } finally {
      conn.release();
    }

    await runBalanceAlertJob({ tenantIds: [fx.tenantId] });
    const rows = await notificationsOf(fx.tenantId);
    assert.equal(rows.length, 1);
    assert.match(rows[0].message, /ALERTE/);
    assert.match(rows[0].message, /débit 15000/);
    assert.match(rows[0].message, /crédit 0/);

    // Nettoyage : l'écriture déséquilibrée elle-même (jamais laissée dans la base jetable).
    await pool.query('DELETE FROM gl_entry_lines WHERE entry_id = :id', { id: entryId });
    await pool.query('DELETE FROM gl_entries WHERE id = :id', { id: entryId });
  },
);

test("un tenant sans module comptabilité avancée activé n'est jamais vérifié", async () => {
  const bare = await createFixture();
  try {
    await pool.query('UPDATE tenants SET gl_module_enabled = 0 WHERE id = :t', { t: bare.tenantId });
    // Même en forçant un déséquilibre, `isModuleActive` doit court-circuiter AVANT toute vérification.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[account]] = await conn.query("SELECT id FROM gl_accounts WHERE tenant_id = :t AND code = '571'", { t: bare.tenantId });
      const [[journal]] = await conn.query("SELECT id FROM gl_journals WHERE tenant_id = :t AND code = 'OD'", { t: bare.tenantId });
      const n = await nextEntryNumber(conn, bare.tenantId);
      const [entry] = await conn.query(
        `INSERT INTO gl_entries (tenant_id, journal_id, fiscal_year_id, entry_number, piece_number, entry_date, narration, status)
         VALUES (:t, :journalId, :fiscalYearId, :n, :n, '2026-05-01', 'Test module desactive', 'validee')`,
        { t: bare.tenantId, journalId: journal.id, fiscalYearId: bare.fiscalYearId, n },
      );
      await conn.query(
        `INSERT INTO gl_entry_lines (entry_id, line_order, account_id, side, amount) VALUES (:entryId, 1, :accountId, 'debit', 5000)`,
        { entryId: entry.insertId, accountId: account.id },
      );
      await conn.commit();
    } finally {
      conn.release();
    }

    await runBalanceAlertJob({ tenantIds: [bare.tenantId] });
    assert.deepEqual(await notificationsOf(bare.tenantId), []);
  } finally {
    await teardown(bare.tenantId);
  }
});
