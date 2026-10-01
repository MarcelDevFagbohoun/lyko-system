'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { computeIncomeStatement, computeBalanceSheet, computeCashFlow } = require('../../src/services/gl/glFinancialStatements');
const { createFixture, setCommissionRate, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10); // 10 %

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Loyer 100 000, commission 10 % -> 10 000 produit (706), 90 000 tiers-propriétaire (4671).
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'loyer_encaisse',
      entryDate: '2026-03-05',
      amount: 100000,
      paymentMethod: 'especes',
      narrationVars: { mois: 'mars 2026', locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    // Dépense 20 000 (604 débit, 571 crédit).
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'depense_fournitures',
      entryDate: '2026-03-10',
      amount: 20000,
      paymentMethod: 'especes',
      narrationVars: { libelle: 'Papeterie' },
      createdBy: fx.dgId,
    });
    await conn.commit();
  } finally {
    conn.release();
  }
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('computeIncomeStatement — produits et charges corrects, résultat = produits - charges', async () => {
  const result = await computeIncomeStatement(pool, fx.tenantId, fx.fiscalYearId);
  assert.equal(result.totalProduits, 10000);
  assert.equal(result.totalCharges, 20000);
  assert.equal(result.resultatNet, -10000);
  assert.ok(result.produits.some((p) => p.code === '706' && p.amount === 10000));
  assert.ok(result.charges.some((c) => c.code === '604' && c.amount === 20000));
});

test('computeBalanceSheet — actif = passif une fois le résultat intégré', async () => {
  const result = await computeBalanceSheet(pool, fx.tenantId, fx.fiscalYearId);
  assert.equal(result.resultatNet, -10000);
  assert.equal(result.totalActif, result.totalPassif);
  assert.equal(result.balanced, true);
  // Caisse (571) : 100 000 encaissés - 20 000 dépensés = 80 000.
  assert.ok(result.actif.some((a) => a.code === '571' && a.amount === 80000));
  // Perte (10 000) ajoutée côté actif pour équilibrer.
  assert.equal(result.totalActif, 90000);
});

test(
  "computeBalanceSheet — bug corrigé (audit comptable du 30/09/2026) : un exercice SANS aucune écriture " +
    "propre reprend quand même le solde CUMULÉ de l'exercice précédent (report à nouveau implicite), " +
    "jamais 0 — aucune écriture de report à nouveau n'existant dans ce module, le bilan doit rester " +
    'cumulatif pour ne pas "perdre" la trésorerie/le résultat des exercices antérieurs',
  async () => {
    const [fy] = await pool.query(
      "INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:t, '2027', '2027-01-01', '2027-12-31', 'ouvert')",
      { t: fx.tenantId },
    );
    const result = await computeBalanceSheet(pool, fx.tenantId, fy.insertId);
    // Exactement les mêmes chiffres que le bilan 2026 ci-dessus (rien de nouveau ne s'est produit entre
    // les deux dates de clôture) — la preuve que rien n'est perdu au changement d'exercice.
    assert.equal(result.resultatNet, -10000);
    assert.equal(result.totalActif, 90000);
    assert.equal(result.totalActif, result.totalPassif);
    assert.equal(result.balanced, true);
    assert.ok(result.actif.some((a) => a.code === '571' && a.amount === 80000), 'la caisse de 2026 doit toujours apparaître fin 2027');
    await pool.query('DELETE FROM gl_fiscal_years WHERE id = :id', { id: fy.insertId });
  },
);

test(
  "computeBalanceSheet — un exercice AVEC sa propre activité cumule correctement avec l'exercice précédent " +
    '(jamais seulement sa propre activité, jamais un simple report sans les nouveaux mouvements)',
  async () => {
    const [fy] = await pool.query(
      "INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:t, '2028', '2028-01-01', '2028-12-31', 'ouvert')",
      { t: fx.tenantId },
    );
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Nouveau loyer de 2028 (50 000, commission 10% -> 5000 produit, 45000 tiers-propriétaire).
      await genererEcriture(conn, {
        tenantId: fx.tenantId,
        operationType: 'loyer_encaisse',
        entryDate: '2028-02-05',
        amount: 50000,
        paymentMethod: 'especes',
        narrationVars: { mois: 'février 2028', locataire: 'Locataire Test' },
        createdBy: fx.dgId,
        context: { leaseId: fx.leaseId },
      });
      await conn.commit();
    } finally {
      conn.release();
    }

    const result = await computeBalanceSheet(pool, fx.tenantId, fy.insertId);
    // Résultat cumulé : -10000 (2026) + 5000 (produit 2028) = -5000.
    assert.equal(result.resultatNet, -5000);
    // Caisse cumulée : 80000 (fin 2026/2027) + 50000 (nouvel encaissement 2028) = 130000.
    assert.ok(result.actif.some((a) => a.code === '571' && a.amount === 130000));
    assert.equal(result.totalActif, result.totalPassif);
    assert.equal(result.balanced, true);

    await pool.query('DELETE el FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id WHERE e.fiscal_year_id = :fy', { fy: fy.insertId });
    await pool.query('DELETE FROM gl_entries WHERE fiscal_year_id = :fy', { fy: fy.insertId });
    await pool.query('DELETE FROM gl_fiscal_years WHERE id = :id', { id: fy.insertId });
  },
);

test('computeBalanceSheet — un tenant SANS AUCUNE écriture (aucun exercice antérieur) reste équilibré (0 = 0), pas de NaN', async () => {
  const isolatedFx = await createFixture();
  try {
    const result = await computeBalanceSheet(pool, isolatedFx.tenantId, isolatedFx.fiscalYearId);
    assert.equal(result.totalActif, 0);
    assert.equal(result.totalPassif, 0);
    assert.equal(result.balanced, true);
    assert.deepEqual(result.actif, []);
    assert.deepEqual(result.passif, []);
  } finally {
    await teardown(isolatedFx.tenantId);
  }
});

test('computeCashFlow — encaissements/décaissements et solde de clôture cohérents', async () => {
  const result = await computeCashFlow(pool, fx.tenantId, { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(result.openingBalance, 0);
  assert.equal(result.totalInflows, 100000);
  assert.equal(result.totalOutflows, 20000);
  assert.equal(result.closingBalance, 80000);
  assert.equal(result.netVariation, 80000);
});

test('computeCashFlow — une période antérieure à toute écriture ne voit rien', async () => {
  const result = await computeCashFlow(pool, fx.tenantId, { from: '2025-01-01', to: '2025-12-31' });
  assert.equal(result.openingBalance, 0);
  assert.equal(result.totalInflows, 0);
  assert.equal(result.totalOutflows, 0);
  assert.equal(result.closingBalance, 0);
});
