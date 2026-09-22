'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('genererEcriture — penalite_retard : débite le tiers-locataire (411), crédite 707, sans ligne de trésorerie', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'penalite_retard',
      entryDate: '2026-04-01',
      amount: 5000,
      narrationVars: { locataire: 'Locataire Test' },
      sourceTable: 'late_fees',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 5000);
    assert.equal(result.totalCredit, 5000);
    assert.equal(result.lines.length, 2);

    const [lines] = await pool.query(
      `SELECT el.side, el.amount, a.code, el.payment_method, tp.display_name
       FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id
       LEFT JOIN gl_third_parties tp ON tp.id = el.third_party_id
       WHERE el.entry_id = :id ORDER BY el.line_order`,
      { id: result.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '411'); // créance sur le locataire, jamais un encaissement
    assert.equal(lines[0].display_name, 'Locataire Test');
    assert.equal(lines[0].payment_method, null, 'aucune ligne de trésorerie ici — rien n\'est encaissé');
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '707'); // produit accessoire (À VALIDER, voir seed)
    assert.equal(lines[1].payment_method, null);
  } finally {
    conn.release();
  }
});
