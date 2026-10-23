'use strict';

/** Back-office : double authentification TOTP et journal d'audit. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAdminToken } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const totp = require('../src/services/totp');

const PWD = 'motdepasse-solide-1';
let server; let base; let adminId; let email; let token;
const hdr = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const post = (path, body, auth = true) => fetch(`${base}/api/admin${path}`, { method: 'POST', headers: auth ? hdr() : { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const sleepStep = () => pool.query('UPDATE platform_admins SET totp_last_step = totp_last_step - 5 WHERE id = :id', { id: adminId }); // simule un pas plus tard

before(async () => {
  email = `sec-${Date.now()}@aim.test`;
  const [a] = await pool.query("INSERT INTO platform_admins (email, name, password_hash) VALUES (:e, 'Admin Sec', :h)", { e: email, h: await hashPassword(PWD) });
  adminId = a.insertId;
  token = signAdminToken({ sub: adminId });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM platform_admin_audit WHERE admin_id = :id OR admin_email = :e', { id: adminId, e: email });
  await pool.query('DELETE FROM platform_admins WHERE id = :id', { id: adminId });
  await closePool();
});

test('TOTP : le code RFC 6238 de référence est reconnu', () => {
  // Vecteur de test RFC 6238 (secret "12345678901234567890" en base32, t=59 s => 94287082 ; 6 derniers chiffres 287082).
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp.codeAt(secret, Math.floor(59 / 30)), '287082');
  assert.notEqual(totp.verifyCode(secret, '287082', 59000), null);
  assert.equal(totp.verifyCode(secret, '000000', 59000), null);
});

test('connexion sans 2FA : accès + entrée de journal', async () => {
  const r = await post('/login', { email, password: PWD }, false);
  assert.equal(r.status, 200);
  const [rows] = await pool.query("SELECT action FROM platform_admin_audit WHERE admin_email = :e", { e: email });
  assert.ok(rows.some((x) => x.action === 'login'));
});

test('activation de la 2FA, puis connexion : code exigé, faux refusé, bon accepté, rejeu refusé', async () => {
  const setup = await (await post('/2fa/setup')).json();
  assert.match(setup.uri, /^otpauth:\/\/totp\//);
  assert.equal((await post('/2fa/enable', { code: '000000' })).status, 400);
  const step = Math.floor(Date.now() / 30000);
  assert.equal((await post('/2fa/enable', { code: totp.codeAt(setup.secret, step) })).status, 200);

  let r = await post('/login', { email, password: PWD }, false);
  assert.equal(r.status, 401);
  assert.match(JSON.stringify(await r.json()), /TOTP_REQUIRED/);
  r = await post('/login', { email, password: PWD, code: '123456' }, false);
  assert.equal(r.status, 401);

  await sleepStep();
  const good = totp.codeAt(setup.secret, step);
  r = await post('/login', { email, password: PWD, code: good }, false);
  assert.equal(r.status, 200);
  r = await post('/login', { email, password: PWD, code: good }, false); // même code réutilisé
  assert.equal(r.status, 401);

  await sleepStep();
  r = await post('/2fa/disable', { password: 'mauvais', code: good });
  assert.equal(r.status, 400);
  r = await post('/2fa/disable', { password: PWD, code: good });
  assert.equal(r.status, 200);
  assert.equal((await post('/login', { email, password: PWD }, false)).status, 200);
});

test('journal : actions sensibles tracées, lisibles par l’admin seulement', async () => {
  const r = await fetch(`${base}/api/admin/audit`, { headers: hdr() });
  assert.equal(r.status, 200);
  const { entries } = await r.json();
  const actions = entries.map((e) => e.action);
  for (const a of ['login', 'login_2fa_failed', '2fa_enabled', '2fa_disabled']) assert.ok(actions.includes(a), a);
  assert.equal((await fetch(`${base}/api/admin/audit`)).status, 401);
});
