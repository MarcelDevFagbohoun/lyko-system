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
    n: 'Électricien Test',
    by: fx.dgId,
  });
  supplierId = s.insertId;
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('depense_entretien SANS paymentMethod (à crédit) : crédite le fournisseur (401), pas la trésorerie', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'depense_entretien',
      entryDate: '2026-04-01',
      amount: 30000,
      // Pas de paymentMethod : rien n'est payé, c'est engagé "à crédit".
      narrationVars: { libelle: 'Réparation électrique' },
      sourceTable: 'expenses',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { supplierId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 30000);
    assert.equal(result.totalCredit, 30000);

    const [lines] = await pool.query(
      `SELECT el.side, el.amount, a.code, el.payment_method, tp.display_name
       FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id
       LEFT JOIN gl_third_parties tp ON tp.id = el.third_party_id
       WHERE el.entry_id = :id ORDER BY el.line_order`,
      { id: result.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '624'); // charge d'entretien, comme d'habitude
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '401'); // fournisseur, PAS la trésorerie
    assert.equal(lines[1].display_name, 'Électricien Test');
    assert.equal(lines[1].payment_method, null);
  } finally {
    conn.release();
  }
});

test('depense_entretien AVEC paymentMethod (payée) : comportement inchangé, crédite la trésorerie', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'depense_entretien',
      entryDate: '2026-04-05',
      amount: 12000,
      paymentMethod: 'especes',
      narrationVars: { libelle: 'Peinture' },
      createdBy: fx.dgId,
    });
    await conn.commit();

    const [lines] = await pool.query(
      `SELECT el.side, a.code, el.payment_method FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id
       WHERE el.entry_id = :id ORDER BY el.line_order`,
      { id: result.entryId },
    );
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '571'); // caisse, comme avant ce livrable
    // Rôle DYNAMIQUE (tresorerie_ou_fournisseur) : doit être reconnu comme
    // ligne de trésorerie au même titre que tresorerie_mode_paiement, sinon
    // `payment_method` reste NULL sur toute dépense payée immédiatement.
    assert.equal(lines[1].payment_method, 'especes');
  } finally {
    conn.release();
  }
});

async function balance401(tenantId) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS solde
     FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id JOIN gl_accounts a ON a.id = el.account_id
     WHERE e.tenant_id = :t AND a.code = '401'`,
    { t: tenantId },
  );
  return Number(row.solde);
}

test('reglement_fournisseur : solde le 401 et sort la trésorerie, jamais une nouvelle charge', async () => {
  const before = await balance401(fx.tenantId);
  const conn = await pool.getConnection();
  try {
    // Engage 30 000 à crédit, puis règle intégralement.
    await conn.beginTransaction();
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'depense_fournitures',
      entryDate: '2026-05-01',
      amount: 30000,
      narrationVars: { libelle: 'Papeterie' },
      createdBy: fx.dgId,
      context: { supplierId },
    });
    const settlement = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'reglement_fournisseur',
      entryDate: '2026-05-20',
      amount: 30000,
      paymentMethod: 'virement',
      narrationVars: { fournisseur: 'Électricien Test' },
      createdBy: fx.dgId,
      context: { supplierId },
    });
    await conn.commit();

    const [lines] = await pool.query(
      `SELECT el.side, el.amount, a.code, el.payment_method FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id
       WHERE el.entry_id = :id ORDER BY el.line_order`,
      { id: settlement.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '401');
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '521'); // virement -> banque
    assert.equal(lines[1].payment_method, 'virement');

    const after = await balance401(fx.tenantId);
    assert.equal(after, before, 'engagé (+30000) puis réglé (-30000) : le solde ne doit pas bouger');
  } finally {
    conn.release();
  }
});
