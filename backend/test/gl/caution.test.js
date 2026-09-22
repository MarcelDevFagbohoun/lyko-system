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

test('genererEcriture — caution_recue : 2 lignes équilibrées, compte 165 + tiers-locataire', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'caution_recue',
      entryDate: '2026-01-01',
      amount: 50000,
      paymentMethod: 'especes',
      narrationVars: { locataire: 'Locataire Test' },
      sourceTable: 'leases',
      sourceId: fx.leaseId,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 50000);
    assert.equal(result.totalCredit, 50000);
    assert.equal(result.lines.length, 2);

    const [lines] = await pool.query(
      `SELECT el.side, el.amount, a.code, el.third_party_id
       FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id
       WHERE el.entry_id = :id ORDER BY el.line_order`,
      { id: result.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '571'); // espèces -> caisse
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '165'); // dépôts et cautionnements reçus
    assert.ok(lines[1].third_party_id, 'la ligne 165 porte bien un tiers-locataire');
  } finally {
    conn.release();
  }
});

test('genererEcriture — caution_restituee : inverse exactement caution_recue', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'caution_restituee',
      entryDate: '2026-06-01',
      amount: 50000,
      paymentMethod: 'especes',
      narrationVars: { locataire: 'Locataire Test' },
      sourceTable: 'move_out_reports',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 50000);
    assert.equal(result.totalCredit, 50000);

    const [lines] = await pool.query(
      `SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id
       WHERE el.entry_id = :id ORDER BY el.line_order`,
      { id: result.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '165'); // on solde la dette envers le locataire
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '571'); // sortie de caisse
  } finally {
    conn.release();
  }
});

test('un même locataire obtient bien 2 tiers distincts : 411 (loyer/charges) et 165 (caution), jamais confondus', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // charge_locative_encaissee crédite le tiers-locataire "générique" (411).
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'charge_locative_encaissee',
      entryDate: '2026-01-05',
      amount: 8000,
      paymentMethod: 'especes',
      narrationVars: { fluide: 'SONEB', periode: 'janvier 2026', locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'caution_recue',
      entryDate: '2026-01-05',
      amount: 50000,
      paymentMethod: 'especes',
      narrationVars: { locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    const [renterRows] = await pool.query('SELECT id FROM renters WHERE id = :id', { id: fx.renterId });
    assert.ok(renterRows[0]);

    const [thirdParties] = await pool.query(
      `SELECT tp.id, a.code AS control_code
       FROM gl_third_parties tp JOIN gl_accounts a ON a.id = tp.control_account_id
       WHERE tp.tenant_id = :t AND tp.party_type = 'renter' AND tp.source_table = 'renters' AND tp.source_id = :rid
       ORDER BY a.code ASC`,
      { t: fx.tenantId, rid: fx.renterId },
    );
    assert.equal(thirdParties.length, 2, 'un tiers sous 411, un autre sous 165 — jamais un seul mélangé');
    assert.deepEqual(
      thirdParties.map((t) => t.control_code),
      ['165', '411'],
    );
    assert.notEqual(thirdParties[0].id, thirdParties[1].id);
  } finally {
    conn.release();
  }
});

async function balance165(tenantId) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS solde
     FROM gl_entry_lines el
     JOIN gl_entries e ON e.id = el.entry_id
     JOIN gl_accounts a ON a.id = el.account_id
     WHERE e.tenant_id = :t AND a.code = '165'`,
    { t: tenantId },
  );
  return Number(row.solde);
}

test("genererEcriture — caution_recue puis restituee : le compte 165 revient exactement à son solde de départ (pas de fuite)", async () => {
  const before = await balance165(fx.tenantId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'caution_recue',
      entryDate: '2026-02-01',
      amount: 75000,
      paymentMethod: 'mobile_money',
      narrationVars: { locataire: 'Solde Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'caution_restituee',
      entryDate: '2026-08-01',
      amount: 75000,
      paymentMethod: 'mobile_money',
      narrationVars: { locataire: 'Solde Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    const after = await balance165(fx.tenantId);
    assert.equal(after, before, 'reçue (+75000) puis restituée (-75000) : le solde ne doit pas bouger');
  } finally {
    conn.release();
  }
});
