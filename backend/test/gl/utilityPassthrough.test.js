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

test('charge_locative_encaissee — réglage par défaut (100 %) : une seule ligne 411, comportement historique inchangé', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'charge_locative_encaissee',
      entryDate: '2026-01-05',
      amount: 8000,
      paymentMethod: 'especes',
      narrationVars: { fluide: 'SONEB', periode: 'janvier 2026', locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    const [lines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.equal(lines.length, 2, 'la ligne 706 à 0 doit être omise, comme une commission à 0 %');
    assert.equal(lines[0].code, '571');
    assert.equal(lines[1].code, '411');
    assert.equal(Number(lines[1].amount), 8000);
  } finally {
    conn.release();
  }
});

test('charge_locative_encaissee — réglage à 90 % : split 411/706 exact, jamais de ligne à 0', async () => {
  await pool.query('UPDATE tenants SET gl_utility_passthrough_percent = 90 WHERE id = :t', { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'charge_locative_encaissee',
      entryDate: '2026-01-10',
      amount: 10000,
      paymentMethod: 'especes',
      narrationVars: { fluide: 'SBEE', periode: 'janvier 2026', locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 10000);
    assert.equal(result.totalCredit, 10000);

    const [lines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.equal(lines.length, 3);
    assert.equal(lines[1].code, '411');
    assert.equal(Number(lines[1].amount), 9000, '90 % de 10000 répercuté au locataire');
    assert.equal(lines[2].code, '706');
    assert.equal(Number(lines[2].amount), 1000, '10 % gardé par le cabinet comme frais de gestion');
  } finally {
    conn.release();
    await pool.query('UPDATE tenants SET gl_utility_passthrough_percent = 100 WHERE id = :t', { t: fx.tenantId });
  }
});

test('charge_locative_encaissee — réglage à 0 % : tout gardé par le cabinet, aucune ligne 411', async () => {
  await pool.query('UPDATE tenants SET gl_utility_passthrough_percent = 0 WHERE id = :t', { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'charge_locative_encaissee',
      entryDate: '2026-01-15',
      amount: 5000,
      paymentMethod: 'especes',
      narrationVars: { fluide: 'SONEB', periode: 'janvier 2026', locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    const [lines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.equal(lines.length, 2, 'la ligne 411 à 0 doit être omise');
    assert.equal(lines[1].code, '706');
    assert.equal(Number(lines[1].amount), 5000);
  } finally {
    conn.release();
    await pool.query('UPDATE tenants SET gl_utility_passthrough_percent = 100 WHERE id = :t', { t: fx.tenantId });
  }
});
