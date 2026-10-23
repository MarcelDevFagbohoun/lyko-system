'use strict';

/** Comptes employés : poste obligatoire, identifiant ≥ 10 caractères ; mot de passe oublié de l'admin par code e-mail. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { hashVerificationCode } = require('../src/utils/verificationCode');
const { verifyPassword } = require('../src/utils/password');
const { generateIdentifier } = require('../src/utils/identifier');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;
let server;
let baseUrl;
const dgEmail = `dg-${Date.now()}@example.com`;

before(async () => {
  fx = await createBareFixture();
  await pool.query("UPDATE users SET email = :e, email_verified_at = NOW() WHERE id = :id", { e: dgEmail, id: fx.dgId });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.query("DELETE FROM users WHERE tenant_id = :t AND role IN ('comptable','agent')", { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

const headers = () => ({
  Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}`,
  'Content-Type': 'application/json',
});
const post = (path, body, h = { 'Content-Type': 'application/json' }) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
const phone = () => `01${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

test('identifiant généré : au moins 10 caractères, jamais deux fois le même', () => {
  const a = generateIdentifier();
  assert.match(a, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(a.replace(/-/g, '').length >= 10);
  assert.notEqual(a, generateIdentifier());
});

test('création d’employé — poste obligatoire, mémorisé, mot de passe temporaire à changer', async () => {
  const base = { firstName: 'Awa', lastName: 'Koffi', phone: phone(), role: 'agent', permissions: [] };
  const missing = await post('/api/employees', base, headers());
  assert.equal(missing.status, 400);

  const ok = await post('/api/employees', { ...base, jobTitle: '  Chargée   de portefeuille ' }, headers());
  assert.equal(ok.status, 201);
  const body = await ok.json();
  assert.equal(body.employee.jobTitle, 'Chargée de portefeuille');
  assert.equal(body.employee.mustChangePassword, true);
  assert.ok(body.employee.identifier.replace(/-/g, '').length >= 10);
  assert.ok(body.temporaryPassword);

  const titles = await (await fetch(`${baseUrl}/api/employees/job-titles`, { headers: headers() })).json();
  assert.ok(titles.custom.includes('Chargée de portefeuille'));
  assert.ok(titles.defaults.includes('Secrétaire'));

  // Un poste de la liste par défaut n'est pas dupliqué dans les postes de l'entreprise.
  const second = await post('/api/employees', { ...base, phone: phone(), jobTitle: 'secrétaire' }, headers());
  assert.equal((await second.json()).employee.jobTitle, 'Secrétaire');
  const after = await (await fetch(`${baseUrl}/api/employees/job-titles`, { headers: headers() })).json();
  assert.deepEqual(after.custom, ['Chargée de portefeuille']);
});

test('mot de passe oublié — réponse identique, code valable une fois, sessions fermées', async () => {
  const unknown = await post('/api/auth/forgot-password', { email: 'inconnu@example.com' });
  const known = await post('/api/auth/forgot-password', { email: dgEmail });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.deepEqual(await unknown.json(), await known.json());

  await pool.query("UPDATE users SET password_reset_code_hash = :h, password_reset_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE), password_reset_attempts = 0 WHERE id = :id", {
    h: await hashVerificationCode('12345678'),
    id: fx.dgId,
  });
  const newPassword = 'Nouveau#Pass2026';
  const wrong = await post('/api/auth/reset-password', { email: dgEmail, code: '00000000', newPassword, confirmNewPassword: newPassword });
  assert.equal(wrong.status, 400);
  const weak = await post('/api/auth/reset-password', { email: dgEmail, code: '12345678', newPassword: 'faible', confirmNewPassword: 'faible' });
  assert.equal(weak.status, 400);
  const ok = await post('/api/auth/reset-password', { email: dgEmail, code: '12345678', newPassword, confirmNewPassword: newPassword });
  assert.equal(ok.status, 200);
  const [[u]] = await pool.query('SELECT password_hash, password_reset_code_hash FROM users WHERE id = :id', { id: fx.dgId });
  assert.ok(await verifyPassword(newPassword, u.password_hash));
  assert.equal(u.password_reset_code_hash, null);
  const reuse = await post('/api/auth/reset-password', { email: dgEmail, code: '12345678', newPassword, confirmNewPassword: newPassword });
  assert.equal(reuse.status, 400);
});
