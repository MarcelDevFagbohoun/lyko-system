'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { nextEntryNumber } = require('../../src/services/gl/glNumbering');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('nextEntryNumber — attribue 1, 2, 3... séquentiellement', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const n1 = await nextEntryNumber(conn, fx.tenantId);
    const n2 = await nextEntryNumber(conn, fx.tenantId);
    const n3 = await nextEntryNumber(conn, fx.tenantId);
    await conn.commit();
    assert.deepEqual([n1, n2, n3], [1, 2, 3]);
  } finally {
    conn.release();
  }
});

test('nextEntryNumber — un ROLLBACK ne laisse jamais de trou (le numéro n\'est jamais « brûlé »)', async () => {
  // Poursuite du compteur précédent : le prochain numéro attendu est 4.
  const failingConn = await pool.getConnection();
  try {
    await failingConn.beginTransaction();
    const n = await nextEntryNumber(failingConn, fx.tenantId);
    assert.equal(n, 4);
    await failingConn.rollback(); // simule un échec APRÈS avoir consommé le numéro 4
  } finally {
    failingConn.release();
  }

  // Le compteur ne doit PAS avoir avancé : le prochain appel doit à nouveau
  // renvoyer 4 (pas 5), sinon la numérotation aurait un trou.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const n = await nextEntryNumber(conn, fx.tenantId);
    await conn.commit();
    assert.equal(n, 4, 'le numéro 4 doit être réattribué après le rollback précédent, jamais sauté');
  } finally {
    conn.release();
  }
});
