'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { requireAuth } = require('../src/middleware/auth');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;
before(async () => {
  fx = await createBareFixture();
  await pool.query('UPDATE users SET must_change_password = 1 WHERE id = :id', { id: fx.dgId });
});
after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

function run(url, mustChange = true) {
  const token = signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg', mustChangePassword: mustChange });
  const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: url };
  return new Promise((resolve) => requireAuth(req, {}, (err) => resolve({ err, req })));
}

test('mot de passe temporaire : une route métier est refusée (403)', async () => {
  const { err } = await run('/api/owners?x=1');
  assert.equal(err.status, 403);
  assert.equal(err.details.code, 'PASSWORD_CHANGE_REQUIRED');
});

test('mot de passe temporaire : changer le mot de passe, /me et la déconnexion restent permis', async () => {
  for (const url of ['/api/auth/change-password', '/api/auth/me', '/api/auth/logout']) {
    assert.equal((await run(url)).err, undefined, url);
  }
});

test('jeton sans indicateur : aucun contrôle ni requête', async () => {
  assert.equal((await run('/api/owners', false)).err, undefined);
});

test('ancien jeton après changement du mot de passe : accepté (la base fait foi)', async () => {
  await pool.query('UPDATE users SET must_change_password = 0 WHERE id = :id', { id: fx.dgId });
  const { err, req } = await run('/api/owners');
  assert.equal(err, undefined);
  assert.equal(req.user.mustChangePassword, false);
});
