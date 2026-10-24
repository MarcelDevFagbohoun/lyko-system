'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { nextEntryNumber } = require('../../src/services/gl/glNumbering');
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
  // Bug corrigé (audit comptabilité avancée du 16/10/2026) : la perte (10 000) réduit les capitaux
  // propres côté PASSIF (90000 tiers-propriétaire - 10000 de perte = 80000), jamais ajoutée côté
  // actif — le total actif reste exactement le solde brut des comptes d'actif (80000, la caisse
  // seule ici), sans aucun ajustement.
  assert.equal(result.totalActif, 80000);
  assert.equal(result.totalPassif, 80000);
});

test(
  'computeBalanceSheet — bug corrigé (audit comptabilité avancée du 16/10/2026) : une perte réduit le ' +
    "total passif (capitaux propres), elle ne s'ajoute JAMAIS au total actif — présentation standard " +
    'SYSCOHADA, contrairement au comportement précédent',
  async () => {
    const result = await computeBalanceSheet(pool, fx.tenantId, fx.fiscalYearId);
    const actifBrut = result.actif.reduce((s, a) => s + a.amount, 0);
    const passifBrut = result.passif.reduce((s, p) => s + p.amount, 0);
    // Le total actif est EXACTEMENT la somme brute des comptes d'actif — jamais gonflé par la perte.
    assert.equal(result.totalActif, actifBrut);
    // Le total passif, lui, intègre le résultat (négatif ici) — c'est LUI qui absorbe la perte.
    assert.equal(result.totalPassif, passifBrut + result.resultatNet);
    assert.ok(result.resultatNet < 0, 'la fixture de ce fichier est bien en perte (-10000)');
    assert.ok(result.totalPassif < passifBrut, 'la perte doit RÉDUIRE le passif brut, pas le laisser intact');
  },
);

test(
  'computeBalanceSheet — un BÉNÉFICE reste bien ajouté au total passif (capitaux propres), jamais à ' +
    "l'actif — comportement inchangé pour ce cas, seul celui de la perte était fautif",
  async () => {
    // Fixture isolée : un commerce en perte (fx, ci-dessus) ne peut pas aussi servir de cas bénéficiaire.
    const iso = await createFixture();
    try {
      await setCommissionRate(iso.tenantId, iso.ownerId, iso.dgId, 10); // 10 % -> produit (706) réel
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        // Loyer encaissé SANS aucune dépense en face : la commission (706, produit) est un bénéfice
        // net puisqu'aucune charge ne la compense dans cette fixture isolée.
        await genererEcriture(conn, {
          tenantId: iso.tenantId,
          operationType: 'loyer_encaisse',
          entryDate: '2026-03-05',
          amount: 30000,
          paymentMethod: 'especes',
          narrationVars: { mois: 'mars 2026', locataire: 'Locataire Test' },
          createdBy: iso.dgId,
          context: { leaseId: iso.leaseId },
        });
        await conn.commit();
      } finally {
        conn.release();
      }

      const result = await computeBalanceSheet(pool, iso.tenantId, iso.fiscalYearId);
      assert.equal(result.resultatNet, 3000); // 10 % de 30000, aucune charge en face
      assert.ok(result.resultatNet > 0);
      const actifBrut = result.actif.reduce((s, a) => s + a.amount, 0);
      const passifBrut = result.passif.reduce((s, p) => s + p.amount, 0);
      assert.equal(result.totalActif, actifBrut, "le total actif n'est jamais ajusté, qu'il y ait bénéfice ou perte");
      assert.equal(result.totalPassif, passifBrut + result.resultatNet);
      assert.ok(result.totalPassif > passifBrut, 'un bénéfice doit AUGMENTER le passif brut');
      assert.equal(result.totalActif, result.totalPassif);
      assert.equal(result.balanced, true);
    } finally {
      await teardown(iso.tenantId);
    }
  },
);

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
    assert.equal(result.totalActif, 80000);
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

test(
  "computeCashFlow — bug corrigé (audit comptabilité avancée du 06/10/2026) : un virement interne " +
    "caisse↔banque (écriture manuelle entre deux comptes de classe 5) ne gonfle ni les encaissements ni " +
    "les décaissements",
  async () => {
    // Avant ce correctif, ce virement se serait ajouté EN ENTIER à totalInflows (débit 571) ET à
    // totalOutflows (crédit 521) — aucun argent n'est pourtant réellement entré ni sorti du cabinet.
    const [[c571]] = await pool.query("SELECT id FROM gl_accounts WHERE tenant_id = :t AND code = '571'", { t: fx.tenantId });
    const [[c521]] = await pool.query("SELECT id FROM gl_accounts WHERE tenant_id = :t AND code = '521'", { t: fx.tenantId });
    const [[odJournal]] = await pool.query("SELECT id FROM gl_journals WHERE tenant_id = :t AND code = 'OD'", { t: fx.tenantId });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const entryNumber = await nextEntryNumber(conn, fx.tenantId);
      const [entry] = await conn.query(
        `INSERT INTO gl_entries (tenant_id, journal_id, fiscal_year_id, entry_number, piece_number, entry_date, narration, status)
         VALUES (:t, :journalId, :fiscalYearId, :n, :n, '2026-06-01', 'Virement interne caisse -> banque', 'validee')`,
        { t: fx.tenantId, journalId: odJournal.id, fiscalYearId: fx.fiscalYearId, n: entryNumber },
      );
      await conn.query(
        `INSERT INTO gl_entry_lines (entry_id, line_order, account_id, side, amount) VALUES
           (:entryId, 1, :c521, 'debit', 30000),
           (:entryId, 2, :c571, 'credit', 30000)`,
        { entryId: entry.insertId, c521: c521.id, c571: c571.id },
      );
      await conn.commit();
    } finally {
      conn.release();
    }

    // Mêmes totaux que le test précédent (100000/20000) : le virement interne de 30000 n'apparaît ni
    // en encaissement ni en décaissement. Le solde de clôture reste également inchangé (un virement
    // entre deux comptes de trésorerie s'annule déjà dans la somme classe 5).
    const result = await computeCashFlow(pool, fx.tenantId, { from: '2026-01-01', to: '2026-12-31' });
    assert.equal(result.totalInflows, 100000);
    assert.equal(result.totalOutflows, 20000);
    assert.equal(result.closingBalance, 80000);
  },
);

test(
  "computeBalanceSheet — un compte d'actif à solde CRÉDITEUR (caisse négative) est reclassé au passif avec " +
    'un avertissement, jamais présenté en négatif dans l’actif (audit du 24/10/2026) ; le bilan reste équilibré',
  async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Caisse encaisse 100 000 puis paie 20 000 (fixture) ; un salaire de 500 000 la rend négative.
      await genererEcriture(conn, {
        tenantId: fx.tenantId,
        operationType: 'salaire_paye',
        entryDate: '2026-03-20',
        amount: 500000,
        paymentMethod: 'especes',
        narrationVars: { mois: 'mars 2026', employe: 'Employé Test' },
        createdBy: fx.dgId,
      });
      await conn.commit();
    } finally {
      conn.release();
    }
    const result = await computeBalanceSheet(pool, fx.tenantId, fx.fiscalYearId);
    assert.ok(result.actif.every((a) => a.amount > 0 || a.code.startsWith('28')), 'aucun montant négatif dans l’actif');
    const caisse = result.passif.find((p) => p.code === '571');
    assert.ok(caisse, 'la caisse créditrice passe au passif');
    assert.ok(caisse.amount > 0 && caisse.amount < 500000, 'montant positif présenté au passif');
    assert.ok(result.warnings.some((w) => w.includes('571')), 'avertissement de caisse négative');
    assert.equal(result.balanced, true);
  },
);
