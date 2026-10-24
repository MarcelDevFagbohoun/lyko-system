'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { previewClosing } = require('../src/services/gl/glClosingService');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;
let other;
before(async () => {
  fx = await createBareFixture();
  other = await createBareFixture();
});
after(async () => {
  await teardown(fx.tenantId);
  await teardown(other.tenantId);
  await closePool();
});

test('garde SQL : un objet/tableau d’objets injecté comme paramètre est refusé (pool)', async () => {
  await assert.rejects(pool.query('SELECT id FROM users WHERE email = :e', { e: { $ne: '' } }), (e) => e.status === 400);
  await assert.rejects(pool.query('SELECT id FROM users WHERE id = :i', { i: { id: 1, tenant_id: 1 } }), (e) => e.status === 400);
  await assert.rejects(pool.query('SELECT id FROM users WHERE id = ?', [[{ a: 1 }]]), (e) => e.status === 400);
});

test('garde SQL : appliquée aussi aux connexions de transaction', async () => {
  const conn = await pool.getConnection();
  try {
    await assert.rejects(conn.query('SELECT 1 WHERE 1 = :x', { x: { a: 1 } }), (e) => e.status === 400);
  } finally {
    conn.release();
  }
});

test('garde SQL : les paramètres légitimes (scalaires, listes IN, dates) passent', async () => {
  const [r1] = await pool.query('SELECT id FROM users WHERE id IN (:ids)', { ids: [fx.dgId, other.dgId] });
  assert.equal(r1.length, 2);
  const [r2] = await pool.query('SELECT :d AS d, :n AS n', { d: new Date(), n: null });
  assert.equal(r2.length, 1);
});

test('payload d’injection classique : traité comme une simple chaîne (aucun résultat, aucune erreur)', async () => {
  for (const payload of ["' OR '1'='1", "'; DROP TABLE users; --", '" OR 1=1 --', '1 UNION SELECT password_hash FROM users']) {
    const [rows] = await pool.query('SELECT id FROM users WHERE email = :e', { e: payload });
    assert.equal(rows.length, 0);
  }
  const [[c]] = await pool.query('SELECT COUNT(*) AS c FROM users');
  assert.ok(c.c > 0);
});

test('isolation : l’aperçu de clôture d’un exercice d’une autre entreprise → 404', async () => {
  const [[fy]] = await pool.query('SELECT id FROM gl_fiscal_years WHERE tenant_id = :t LIMIT 1', { t: other.tenantId });
  if (!fy) return; // fixture sans exercice : rien à sonder
  await assert.rejects(previewClosing(pool, fx.tenantId, fy.id), (e) => e.status === 404);
  await assert.rejects(previewClosing(pool, fx.tenantId, 99999999), (e) => e.status === 404);
});

test('connexion employé : le poste n’est plus requis (optionnel), mais s’il est fourni il doit être valide', () => {
  const { employeeLoginSchema } = require('../src/validators/auth');
  assert.equal(employeeLoginSchema.safeParse({ identifier: '7f3k-9qxm-2ptd', password: 'x' }).success, true);
  assert.equal(employeeLoginSchema.safeParse({ identifier: '7F3K-9QXM-2PTD', role: 'dg', password: 'x' }).success, false);
});
