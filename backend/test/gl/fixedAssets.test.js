'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { createFixture, teardown } = require('./fixtures');

let fx;
let supplierId;

before(async () => {
  fx = await createFixture();
  const [s] = await pool.query('INSERT INTO suppliers (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Informatique Pro',
    by: fx.dgId,
  });
  supplierId = s.insertId;
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('immobilisation_informatique_acquise PAYÉE : débite 2442, crédite la trésorerie', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'immobilisation_informatique_acquise',
      entryDate: '2026-01-15',
      amount: 600000,
      paymentMethod: 'virement',
      narrationVars: { libelle: '3 ordinateurs portables' },
      sourceTable: 'fixed_assets',
      sourceId: 1,
      createdBy: fx.dgId,
    });
    await conn.commit();

    assert.equal(result.totalDebit, 600000);
    assert.equal(result.totalCredit, 600000);
    const [lines] = await pool.query(
      'SELECT el.side, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '2442');
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '521'); // virement -> banque
  } finally {
    conn.release();
  }
});

test('immobilisation_transport_acquise À CRÉDIT : crédite 481 (PAS 401), tiers distinct du fournisseur habituel', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'immobilisation_transport_acquise',
      entryDate: '2026-02-01',
      amount: 3500000,
      narrationVars: { libelle: 'Véhicule de service' },
      sourceTable: 'fixed_assets',
      sourceId: 2,
      createdBy: fx.dgId,
      context: { supplierId },
    });
    await conn.commit();

    const [lines] = await pool.query(
      `SELECT el.side, el.amount, a.code, tp.display_name
       FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id
       LEFT JOIN gl_third_parties tp ON tp.id = el.third_party_id
       WHERE el.entry_id = :id ORDER BY el.line_order`,
      { id: result.entryId },
    );
    assert.equal(lines[0].code, '2451');
    assert.equal(lines[1].code, '481'); // fournisseurs d'investissements, jamais 401
    assert.equal(lines[1].display_name, 'Informatique Pro');
  } finally {
    conn.release();
  }
});

test('un même fournisseur a bien 3 sous-comptes distincts (401 dépense, 481 investissement) — jamais confondus', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Une dépense "à crédit" ordinaire (401) pour le MÊME fournisseur.
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'depense_fournitures',
      entryDate: '2026-02-05',
      amount: 20000,
      narrationVars: { libelle: 'Toner imprimante' },
      createdBy: fx.dgId,
      context: { supplierId },
    });
    await conn.commit();

    const [thirdParties] = await pool.query(
      `SELECT a.code FROM gl_third_parties tp JOIN gl_accounts a ON a.id = tp.control_account_id
       WHERE tp.tenant_id = :t AND tp.party_type = 'supplier' AND tp.source_table = 'suppliers' AND tp.source_id = :sid
       ORDER BY a.code ASC`,
      { t: fx.tenantId, sid: supplierId },
    );
    assert.deepEqual(thirdParties.map((t) => t.code), ['401', '481']);
  } finally {
    conn.release();
  }
});

test('amortissement_informatique : débite 681, crédite 28442 (compte soustractif, jamais une charge)', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'amortissement_informatique',
      entryDate: '2026-02-01',
      amount: 16667, // 600000 / 3 ans / 12 mois, arrondi
      narrationVars: { libelle: '3 ordinateurs portables — février 2026' },
      sourceTable: 'fixed_asset_depreciations',
      sourceId: 1,
      createdBy: fx.dgId,
    });
    await conn.commit();

    const [lines] = await pool.query(
      'SELECT el.side, a.code, a.account_type FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '681');
    assert.equal(lines[0].account_type, 'charge');
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '28442');
  } finally {
    conn.release();
  }
});

// ───── bug corrigé (audit comptable du 30/09/2026) : sortie d'immobilisation, jusqu'ici IMPOSSIBLE ─────

test("sortie_informatique — VNC PARTIELLE : solde 2442 (crédit, coût total), débite 28442 (amortissement cumulé) ET 654 (perte résiduelle)", async () => {
  const conn = await pool.getConnection();
  try {
    // Un bien de 600000, amorti de 100000 à ce jour (VNC résiduelle = 500000).
    const [asset] = await pool.query(
      `INSERT INTO fixed_assets (tenant_id, label, category, acquisition_date, acquisition_cost, useful_life_years, payment_status, payment_method, created_by)
       VALUES (:t, 'Ordinateur test', 'informatique', '2025-01-01', 600000, 3, 'paid', 'virement', :by)`,
      { t: fx.tenantId, by: fx.dgId },
    );
    await pool.query(
      'INSERT INTO fixed_asset_depreciations (tenant_id, fixed_asset_id, period, amount, recorded_by) VALUES (:t, :aid, :period, :amount, :by)',
      { t: fx.tenantId, aid: asset.insertId, period: '2026-01', amount: 100000, by: fx.dgId },
    );

    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'sortie_informatique',
      entryDate: '2026-04-01',
      amount: 600000, // coût d'acquisition brut, jamais la VNC
      narrationVars: { libelle: 'Ordinateur volé' },
      sourceTable: 'fixed_assets',
      sourceId: asset.insertId,
      createdBy: fx.dgId,
      context: { fixedAssetId: asset.insertId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 600000);
    assert.equal(result.totalCredit, 600000);
    const [lines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.deepEqual(
      lines.map((l) => [l.side, l.code, Number(l.amount)]),
      [
        ['debit', '28442', 100000], // solde l'amortissement déjà pratiqué
        ['debit', '654', 500000], // valeur nette comptable résiduelle, passée en charge
        ['credit', '2442', 600000], // le bien sort du patrimoine pour son coût brut
      ],
    );

    await pool.query('DELETE FROM fixed_assets WHERE id = :id', { id: asset.insertId });
  } finally {
    conn.release();
  }
});

test('sortie_mobilier — VNC NULLE (déjà entièrement amorti) : aucune ligne 654 (jamais une charge à 0)', async () => {
  const conn = await pool.getConnection();
  try {
    const [asset] = await pool.query(
      `INSERT INTO fixed_assets (tenant_id, label, category, acquisition_date, acquisition_cost, useful_life_years, payment_status, payment_method, created_by)
       VALUES (:t, 'Bureau test', 'mobilier', '2023-01-01', 150000, 3, 'paid', 'especes', :by)`,
      { t: fx.tenantId, by: fx.dgId },
    );
    await pool.query(
      'INSERT INTO fixed_asset_depreciations (tenant_id, fixed_asset_id, period, amount, recorded_by) VALUES (:t, :aid, :period, :amount, :by)',
      { t: fx.tenantId, aid: asset.insertId, period: '2026-01', amount: 150000, by: fx.dgId },
    );

    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'sortie_mobilier',
      entryDate: '2026-04-01',
      amount: 150000, // entièrement amorti : VNC = 0
      narrationVars: { libelle: 'Bureau mis au rebut' },
      sourceTable: 'fixed_assets',
      sourceId: asset.insertId,
      createdBy: fx.dgId,
      context: { fixedAssetId: asset.insertId },
    });
    await conn.commit();

    const [lines] = await pool.query(
      'SELECT el.side, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.equal(lines.length, 2, 'jamais de ligne 654 à 0 FCFA');
    assert.deepEqual(lines.map((l) => [l.side, l.code]), [
      ['debit', '28444'],
      ['credit', '2444'],
    ]);

    await pool.query('DELETE FROM fixed_assets WHERE id = :id', { id: asset.insertId });
  } finally {
    conn.release();
  }
});

test("sortie_transport — AUCUN amortissement encore pratiqué : toute la valeur part directement en perte (654), aucune ligne 28451 à 0", async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'sortie_transport',
      entryDate: '2026-04-01',
      amount: 3500000,
      narrationVars: { libelle: 'Véhicule accidenté, jamais amorti' },
      sourceTable: 'fixed_assets',
      sourceId: 779, // aucune ligne fixed_asset_depreciations pour cet id
      createdBy: fx.dgId,
      context: { fixedAssetId: 779 },
    });
    await conn.commit();

    const [lines] = await pool.query(
      'SELECT el.side, a.code, el.amount FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.equal(lines.length, 2, 'jamais de ligne 28451 à 0 FCFA');
    assert.deepEqual(lines.map((l) => [l.side, l.code, Number(l.amount)]), [
      ['debit', '654', 3500000],
      ['credit', '2451', 3500000],
    ]);
  } finally {
    conn.release();
  }
});

test('reglement_fournisseur_investissement : solde le 481, jamais le 401 du même fournisseur', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'immobilisation_mobilier_acquise',
      entryDate: '2026-03-01',
      amount: 150000,
      narrationVars: { libelle: 'Bureaux et chaises' },
      createdBy: fx.dgId,
      context: { supplierId },
    });
    const settlement = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'reglement_fournisseur_investissement',
      entryDate: '2026-03-20',
      amount: 150000,
      paymentMethod: 'especes',
      narrationVars: { fournisseur: 'Informatique Pro' },
      createdBy: fx.dgId,
      context: { supplierId },
    });
    await conn.commit();

    const [lines] = await pool.query(
      'SELECT el.side, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: settlement.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '481');
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '571');
  } finally {
    conn.release();
  }
});
