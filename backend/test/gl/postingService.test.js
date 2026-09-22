'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture, renderNarration } = require('../../src/services/gl/glPostingService');
const { createFixture, setCommissionRate, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('renderNarration remplace les variables connues et laisse les autres intactes', () => {
  const result = renderNarration('Loyer {mois} — {locataire}', { mois: 'janvier 2026', locataire: 'Kofi' });
  assert.equal(result, 'Loyer janvier 2026 — Kofi');
  assert.equal(renderNarration('Sans variable', {}), 'Sans variable');
  assert.equal(renderNarration('{inconnue}', {}), '{inconnue}');
});

test('genererEcriture — dépense simple : 2 lignes équilibrées, comptes attendus', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'depense_fournitures',
      entryDate: '2026-03-10',
      amount: 15000,
      paymentMethod: 'especes',
      narrationVars: { libelle: 'Papeterie' },
      sourceTable: 'expenses',
      sourceId: 999,
      createdBy: fx.dgId,
    });
    await conn.commit();

    assert.equal(result.totalDebit, 15000);
    assert.equal(result.totalCredit, 15000);
    assert.equal(result.lines.length, 2);

    const [lines] = await pool.query(
      `SELECT el.side, el.amount, a.code FROM gl_entry_lines el
       JOIN gl_accounts a ON a.id = el.account_id
       WHERE el.entry_id = :id ORDER BY el.line_order`,
      { id: result.entryId },
    );
    assert.deepEqual(
      lines.map((l) => ({ side: l.side, amount: Number(l.amount), code: l.code })),
      [
        { side: 'debit', amount: 15000, code: '604' },
        { side: 'credit', amount: 15000, code: '571' }, // espèces -> caisse
      ],
    );
  } finally {
    conn.release();
  }
});

test('genererEcriture — loyer encaissé AVEC commission : 3 lignes, split correct', async () => {
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10); // 10 %
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'loyer_encaisse',
      entryDate: '2026-03-05',
      amount: 50000,
      paymentMethod: 'mobile_money',
      narrationVars: { mois: 'mars 2026', locataire: 'Locataire Test' },
      sourceTable: 'rent_payments',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 50000);
    assert.equal(result.totalCredit, 50000);
    assert.equal(result.lines.length, 3, 'trésorerie + produit commission + tiers propriétaire');

    const commissionLine = result.lines.find((l) => l.side === 'credit' && l.amount === 5000);
    const ownerLine = result.lines.find((l) => l.side === 'credit' && l.amount === 45000);
    assert.ok(commissionLine, 'ligne commission (10% de 50000 = 5000) attendue');
    assert.ok(ownerLine, 'ligne tiers-propriétaire (45000 net) attendue');
  } finally {
    conn.release();
  }
});

test('genererEcriture — loyer encaissé SANS commission définie (0 %) : la ligne produit est omise', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Nouveau propriétaire sans aucun taux défini dans owner_commission_rates.
    const [owner2] = await conn.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
      t: fx.tenantId,
      n: 'Propriétaire Sans Commission',
      by: fx.dgId,
    });
    const [property2] = await conn.query(
      'INSERT INTO properties (tenant_id, code, owner_id, address, created_by) VALUES (:t, :c, :o, :a, :by)',
      { t: fx.tenantId, c: 'GLT-002', o: owner2.insertId, a: 'Adresse 2', by: fx.dgId },
    );
    const [unit2] = await conn.query(
      "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'U2', 'studio', 'loue', 30000, :by)",
      { t: fx.tenantId, p: property2.insertId, by: fx.dgId },
    );
    const [lease2] = await conn.query(
      "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-01-01', 30000, 5, 30000, 'active', :by)",
      { t: fx.tenantId, r: fx.renterId, u: unit2.insertId, by: fx.dgId },
    );

    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'loyer_encaisse',
      entryDate: '2026-03-05',
      amount: 30000,
      paymentMethod: 'especes',
      narrationVars: { mois: 'mars 2026', locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: lease2.insertId },
    });

    assert.equal(result.lines.length, 2, 'sans commission, seules trésorerie + tiers-propriétaire (montant complet)');
    assert.equal(result.totalDebit, 30000);
    assert.equal(result.totalCredit, 30000);
    await conn.rollback(); // ne pollue pas la suite — ce test est isolé
  } finally {
    conn.release();
  }
});

test('genererEcriture — refuse un type d\'opération inconnu', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assert.rejects(
      () =>
        genererEcriture(conn, {
          tenantId: fx.tenantId,
          operationType: 'operation_qui_n_existe_pas',
          entryDate: '2026-03-05',
          amount: 1000,
          paymentMethod: 'especes',
          narrationVars: {},
        }),
      /inconnu/,
    );
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('genererEcriture — refuse un montant nul ou négatif', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assert.rejects(() =>
      genererEcriture(conn, {
        tenantId: fx.tenantId,
        operationType: 'depense_autre',
        entryDate: '2026-03-05',
        amount: 0,
        paymentMethod: 'especes',
        narrationVars: {},
      }),
    );
    await assert.rejects(() =>
      genererEcriture(conn, {
        tenantId: fx.tenantId,
        operationType: 'depense_autre',
        entryDate: '2026-03-05',
        amount: -500,
        paymentMethod: 'especes',
        narrationVars: {},
      }),
    );
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('genererEcriture — refuse une date hors de tout exercice ouvert', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assert.rejects(
      () =>
        genererEcriture(conn, {
          tenantId: fx.tenantId,
          operationType: 'depense_autre',
          entryDate: '2030-01-01', // aucun exercice ne couvre cette date dans la fixture
          amount: 1000,
          paymentMethod: 'especes',
          narrationVars: {},
        }),
      /exercice/,
    );
  } finally {
    await conn.rollback();
    conn.release();
  }
});
