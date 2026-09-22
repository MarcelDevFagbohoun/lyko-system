'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { cloturerExercice } = require('../../src/services/gl/glClosingService');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('cloturerExercice — verrouille définitivement : plus aucune écriture possible après', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'depense_autre',
      entryDate: '2026-05-01',
      amount: 2000,
      paymentMethod: 'especes',
      narrationVars: { libelle: 'Avant clôture' },
      createdBy: fx.dgId,
    });
    await conn.commit();
  } finally {
    conn.release();
  }

  const conn2 = await pool.getConnection();
  try {
    await conn2.beginTransaction();
    const { totalDebit, totalCredit } = await cloturerExercice(conn2, {
      tenantId: fx.tenantId,
      fiscalYearId: fx.fiscalYearId,
      userId: fx.dgId,
    });
    await conn2.commit();
    assert.equal(totalDebit, totalCredit);
  } finally {
    conn2.release();
  }

  const [[fy]] = await pool.query('SELECT status FROM gl_fiscal_years WHERE id = :id', { id: fx.fiscalYearId });
  assert.equal(fy.status, 'cloture');

  const conn3 = await pool.getConnection();
  try {
    await conn3.beginTransaction();
    await assert.rejects(
      () =>
        genererEcriture(conn3, {
          tenantId: fx.tenantId,
          operationType: 'depense_autre',
          entryDate: '2026-05-15', // toujours dans l'exercice 2026, mais désormais clôturé
          amount: 1000,
          paymentMethod: 'especes',
          narrationVars: { libelle: 'Après clôture — doit échouer' },
          createdBy: fx.dgId,
        }),
      /clôturé/,
    );
  } finally {
    await conn3.rollback();
    conn3.release();
  }
});

test('cloturerExercice — refuse de clôturer deux fois le même exercice', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assert.rejects(
      () => cloturerExercice(conn, { tenantId: fx.tenantId, fiscalYearId: fx.fiscalYearId, userId: fx.dgId }),
      /déjà clôturé/,
    );
  } finally {
    await conn.rollback();
    conn.release();
  }
});
