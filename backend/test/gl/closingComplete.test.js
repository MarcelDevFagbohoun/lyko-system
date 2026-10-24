'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { cloturerExercice, previewClosing, getOpeningBalances } = require('../../src/services/gl/glClosingService');
const { computeIncomeStatement, computeBalanceSheet } = require('../../src/services/gl/glFinancialStatements');
const { createFixture, setCommissionRate, teardown } = require('./fixtures');

let fx;
let fy2027;

before(async () => {
  fx = await createFixture();
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10);
  const [r] = await pool.query(
    "INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:t, '2027', '2027-01-01', '2027-12-31', 'ouvert')",
    { t: fx.tenantId },
  );
  fy2027 = r.insertId;
});
after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

async function post(operationType, entryDate, amount, extra = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await genererEcriture(conn, {
      tenantId: fx.tenantId, operationType, entryDate, amount, paymentMethod: 'especes',
      narrationVars: { locataire: 'L', mois: 'm', libelle: 'x' }, createdBy: fx.dgId,
      context: { leaseId: fx.leaseId, ownerId: fx.ownerId }, ...extra,
    });
    await conn.commit();
    return r;
  } finally {
    conn.release();
  }
}

async function close(fyId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await cloturerExercice(conn, { tenantId: fx.tenantId, fiscalYearId: fyId, userId: fx.dgId });
    await conn.commit();
    return r;
  } finally {
    conn.release();
  }
}

async function balanceOf(code) {
  const [[r]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side='credit' THEN el.amount ELSE -el.amount END),0) AS s
       FROM gl_entry_lines el JOIN gl_entries e ON e.id=el.entry_id JOIN gl_accounts a ON a.id=el.account_id
      WHERE e.tenant_id=:t AND a.code=:c`,
    { t: fx.tenantId, c: code },
  );
  return Number(r.s);
}

test('mode simple (défaut) : la clôture ne passe aucune écriture', async () => {
  const [[fy]] = await pool.query('SELECT 1');
  void fy;
  const conn = await pool.getConnection();
  const [[before]] = await conn.query('SELECT COUNT(*) n FROM gl_entries WHERE tenant_id = :t', { t: fx.tenantId });
  conn.release();
  assert.equal(Number(before.n), 0);
});

test('mode complet : bénéfice -> 121, comptes de gestion soldés, compte de résultat inchangé, bilan équilibré', async () => {
  await pool.query("UPDATE tenants SET gl_closing_mode = 'complet' WHERE id = :t", { t: fx.tenantId });
  await post('loyer_encaisse', '2026-03-05', 100000); // commission 10 000
  await post('depense_autre', '2026-04-01', 3000);

  const preview = await previewClosing(pool, fx.tenantId, fx.fiscalYearId);
  assert.equal(preview.mode, 'complet');
  assert.equal(preview.resultat, 7000);
  assert.equal(preview.destinationAccount, '121');

  const incomeBefore = await computeIncomeStatement(pool, fx.tenantId, fx.fiscalYearId);
  const res = await close(fx.fiscalYearId);
  assert.ok(res.closingEntryId);
  assert.equal(res.resultat, 7000);
  assert.equal(res.totalDebit, res.totalCredit);

  assert.equal(await balanceOf('121'), 7000);
  assert.equal(await balanceOf('706'), 0);

  const incomeAfter = await computeIncomeStatement(pool, fx.tenantId, fx.fiscalYearId);
  assert.equal(incomeAfter.resultatNet, incomeBefore.resultatNet, "le compte de résultat de l'exercice clos ne change pas");
  assert.equal(incomeAfter.resultatNet, 7000);

  const bilan = await computeBalanceSheet(pool, fx.tenantId, fx.fiscalYearId);
  assert.equal(bilan.balanced, true);
  assert.equal(bilan.resultatNet, 0, 'résultat désormais en capitaux propres');
  assert.ok(bilan.passif.some((l) => l.code === '121' && l.amount === 7000));
});

test("exercice suivant : report à nouveau visible, bilan 2027 équilibré, perte -> 129", async () => {
  const opening = await getOpeningBalances(pool, fx.tenantId, fy2027);
  assert.equal(opening.reduce((s, r) => s + r.debit, 0), opening.reduce((s, r) => s + r.credit, 0), "balance d'ouverture équilibrée");
  assert.ok(opening.some((r) => r.code === '121' && r.credit === 7000));

  await post('depense_autre', '2027-02-01', 2500);
  const bilan = await computeBalanceSheet(pool, fx.tenantId, fy2027);
  assert.equal(bilan.balanced, true);
  assert.equal(bilan.resultatNet, -2500);

  const preview = await previewClosing(pool, fx.tenantId, fy2027);
  assert.equal(preview.destinationAccount, '129');
  const res = await close(fy2027);
  assert.equal(res.resultat, -2500);
  assert.equal(await balanceOf('129'), -2500);
  const after = await computeBalanceSheet(pool, fx.tenantId, fy2027);
  assert.equal(after.balanced, true);
  assert.equal(after.resultatNet, 0);
});

test('clôture sans mouvement de gestion : pas d\'écriture de clôture, pas d\'erreur', async () => {
  const [r] = await pool.query(
    "INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:t, '2028', '2028-01-01', '2028-12-31', 'ouvert')",
    { t: fx.tenantId },
  );
  const res = await close(r.insertId);
  assert.equal(res.closingEntryId, null);
});

test("balance d'ouverture : résultat non affecté (clôture simple) ajouté pour rester équilibrée", async () => {
  await pool.query("UPDATE tenants SET gl_closing_mode = 'simple' WHERE id = :t", { t: fx.tenantId });
  const [r] = await pool.query(
    "INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:t, '2029', '2029-01-01', '2029-12-31', 'ouvert')",
    { t: fx.tenantId },
  );
  await post('loyer_encaisse', '2029-06-05', 100000);
  const [r2] = await pool.query(
    "INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:t, '2030', '2030-01-01', '2030-12-31', 'ouvert')",
    { t: fx.tenantId },
  );
  void r;
  const opening = await getOpeningBalances(pool, fx.tenantId, r2.insertId);
  assert.equal(opening.reduce((s, x) => s + x.debit, 0), opening.reduce((s, x) => s + x.credit, 0));
  assert.ok(opening.some((x) => x.code === '—'));
});
