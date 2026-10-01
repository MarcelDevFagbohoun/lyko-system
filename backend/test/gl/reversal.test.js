'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { extourneEcriture } = require('../../src/services/gl/glReversalService');
const { createFixture, teardown } = require('./fixtures');

let fx;
let originalEntryId;

before(async () => {
  fx = await createFixture();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'depense_entretien',
      entryDate: '2026-04-01',
      amount: 8000,
      paymentMethod: 'especes',
      narrationVars: { libelle: 'Réparation plomberie' },
      createdBy: fx.dgId,
    });
    await conn.commit();
    originalEntryId = result.entryId;
  } finally {
    conn.release();
  }
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('extourneEcriture — crée une écriture miroir avec les lignes inversées, toujours équilibrée', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { reversalId } = await extourneEcriture(conn, {
      tenantId: fx.tenantId,
      entryId: originalEntryId,
      entryDate: '2026-04-02',
      userId: fx.dgId,
      reason: 'Erreur de saisie',
    });
    await conn.commit();

    const [originalLines] = await pool.query(
      'SELECT side, amount, account_id FROM gl_entry_lines WHERE entry_id = :id ORDER BY line_order',
      { id: originalEntryId },
    );
    const [reversalLines] = await pool.query(
      'SELECT side, amount, account_id FROM gl_entry_lines WHERE entry_id = :id ORDER BY line_order',
      { id: reversalId },
    );

    assert.equal(reversalLines.length, originalLines.length);
    for (let i = 0; i < originalLines.length; i += 1) {
      assert.equal(Number(reversalLines[i].amount), Number(originalLines[i].amount));
      assert.equal(reversalLines[i].account_id, originalLines[i].account_id);
      assert.equal(reversalLines[i].side, originalLines[i].side === 'debit' ? 'credit' : 'debit');
    }

    const totalDebit = reversalLines.filter((l) => l.side === 'debit').reduce((s, l) => s + Number(l.amount), 0);
    const totalCredit = reversalLines.filter((l) => l.side === 'credit').reduce((s, l) => s + Number(l.amount), 0);
    assert.equal(totalDebit, totalCredit);

    const [[original]] = await pool.query('SELECT status, reversed_by_entry_id FROM gl_entries WHERE id = :id', {
      id: originalEntryId,
    });
    assert.equal(original.status, 'extournee');
    assert.equal(original.reversed_by_entry_id, reversalId);
  } finally {
    conn.release();
  }
});

test('extourneEcriture — refuse d\'extourner une écriture déjà extournée', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assert.rejects(
      () =>
        extourneEcriture(conn, {
          tenantId: fx.tenantId,
          entryId: originalEntryId,
          entryDate: '2026-04-03',
          userId: fx.dgId,
        }),
      /déjà été extournée/,
    );
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('extourneEcriture — refuse une écriture introuvable', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assert.rejects(
      () =>
        extourneEcriture(conn, {
          tenantId: fx.tenantId,
          entryId: 999999999,
          entryDate: '2026-04-03',
          userId: fx.dgId,
        }),
      /introuvable/,
    );
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('extourneEcriture — audit sécurité : deux extournes concurrentes sur la MÊME écriture ne peuvent pas ensemble s\'exécuter', async () => {
  // Écriture dédiée (celle du `before()` est déjà extournée par un test précédent).
  const seedConn = await pool.getConnection();
  let entryId;
  try {
    await seedConn.beginTransaction();
    const result = await genererEcriture(seedConn, {
      tenantId: fx.tenantId,
      operationType: 'depense_entretien',
      entryDate: '2026-04-05',
      amount: 4500,
      paymentMethod: 'especes',
      narrationVars: { libelle: 'Réparation électricité' },
      createdBy: fx.dgId,
    });
    await seedConn.commit();
    entryId = result.entryId;
  } finally {
    seedConn.release();
  }

  const attempt = async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await extourneEcriture(conn, {
        tenantId: fx.tenantId,
        entryId,
        entryDate: '2026-04-06',
        userId: fx.dgId,
        reason: 'Test concurrence',
      });
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  };

  // Sans le verrou (`FOR UPDATE` + compare-and-swap), les deux pouvaient
  // toutes les deux lire `status = 'validee'` et produire chacune leur
  // propre écriture miroir — inversant l'effet économique deux fois.
  const results = await Promise.allSettled([attempt(), attempt()]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'une seule des deux extournes concurrentes doit réussir');
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /déjà été extournée/);

  const [reversalRows] = await pool.query(
    "SELECT id FROM gl_entries WHERE tenant_id = :t AND reverses_entry_id = :entryId",
    { t: fx.tenantId, entryId },
  );
  assert.equal(reversalRows.length, 1, 'une seule écriture miroir doit exister, jamais deux');
});
