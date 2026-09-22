'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { computeMandantsCabinetIndicator } = require('../../src/services/gl/glMandantsCabinetService');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('le seed tague les 2 comptes renommables avec leur system_key', async () => {
  const [rows] = await pool.query(
    "SELECT code, system_key FROM gl_accounts WHERE tenant_id = :t AND system_key IS NOT NULL ORDER BY system_key",
    { t: fx.tenantId },
  );
  assert.deepEqual(
    rows.map((r) => ({ code: r.code, systemKey: r.system_key })),
    [
      { code: '707', systemKey: 'late_fee_income_account' },
      { code: '4671', systemKey: 'owner_control_account' },
    ],
  );
});

test("renommer le compte propriétaires (4671 -> 46) n'affecte pas la résolution des écritures futures", async () => {
  // 1er loyer AVANT renommage.
  await genererEcriture(pool, {
    tenantId: fx.tenantId,
    operationType: 'loyer_encaisse',
    entryDate: '2026-01-05',
    amount: 60000,
    paymentMethod: 'virement',
    narrationVars: { mois: '2026-01', locataire: 'Locataire Test' },
    sourceTable: 'rent_payments',
    sourceId: 1,
    createdBy: fx.dgId,
    context: { leaseId: fx.leaseId },
  });

  // Renommage — exactement ce que fait PATCH /api/gl/accounts/renameable/:key,
  // reproduit ici en SQL direct (pas de supertest dans ce projet).
  await pool.query(
    "UPDATE gl_accounts SET code = '46' WHERE tenant_id = :t AND system_key = 'owner_control_account'",
    { t: fx.tenantId },
  );

  // 2e loyer APRÈS renommage — doit retomber sur le MÊME compte (maintenant '46').
  await genererEcriture(pool, {
    tenantId: fx.tenantId,
    operationType: 'loyer_encaisse',
    entryDate: '2026-02-05',
    amount: 40000,
    paymentMethod: 'virement',
    narrationVars: { mois: '2026-02', locataire: 'Locataire Test' },
    sourceTable: 'rent_payments',
    sourceId: 2,
    createdBy: fx.dgId,
    context: { leaseId: fx.leaseId },
  });

  // Un seul compte '46' porte les deux écritures — aucun '4671' résiduel,
  // aucun compte dupliqué créé après le renommage.
  const [accounts] = await pool.query(
    "SELECT id, code FROM gl_accounts WHERE tenant_id = :t AND system_key = 'owner_control_account'",
    { t: fx.tenantId },
  );
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].code, '46');

  const [[balance]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS solde
     FROM gl_entry_lines el WHERE el.account_id = :id`,
    { id: accounts[0].id },
  );
  assert.equal(Number(balance.solde), 100000, '60000 + 40000, les deux écritures sur le même compte renommé');

  // L'indicateur mandants/cabinet (qui résout par system_key, pas par code)
  // doit voir les deux montants malgré le renommage entre les deux.
  const indicator = await computeMandantsCabinetIndicator(pool, fx.tenantId);
  assert.equal(indicator.dueToOwners, 100000);
});

test('renommer le compte des pénalités (707 -> 758) : la règle déjà seedée (account_id fixe) continue de fonctionner', async () => {
  await pool.query(
    "UPDATE gl_accounts SET code = '758' WHERE tenant_id = :t AND system_key = 'late_fee_income_account'",
    { t: fx.tenantId },
  );

  const result = await genererEcriture(pool, {
    tenantId: fx.tenantId,
    operationType: 'penalite_retard',
    entryDate: '2026-01-10',
    amount: 5000,
    narrationVars: { locataire: 'Locataire Test' },
    sourceTable: 'late_fees',
    sourceId: 1,
    createdBy: fx.dgId,
    context: { leaseId: fx.leaseId },
  });

  const [lines] = await pool.query(
    'SELECT el.side, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
    { id: result.entryId },
  );
  assert.equal(lines[1].side, 'credit');
  assert.equal(lines[1].code, '758', 'la règle seedée (account_id fixe, résolu une fois pour toutes) suit le compte renommé');
});
