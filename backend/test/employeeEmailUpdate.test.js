'use strict';

/**
 * Bug corrigé (trouvé en vérifiant « Biens à vendre », 2026-10-18) : `PATCH /api/employees/:id`
 * rejetait `email: null` (seul `undefined`/`''` étaient acceptés) alors que le frontend
 * (`editer-view.tsx`) envoie justement `email: null` quand le champ est laissé vide — bloquant TOUTE
 * sauvegarde (pas seulement l'email) sur la fiche d'un employé sans email au dossier, le cas courant.
 * Voir validators/employee.js `emailSchema`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;
let server;
let baseUrl;
let employeeId; // comptable SANS email — reproduit exactement le cas signalé.

before(async () => {
  fx = await createBareFixture();
  const [r] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'comptable', 'Sans', 'Email', :phone, 'x')",
    { t: fx.tenantId, phone: `06${Math.floor(Math.random() * 100000000)}` },
  );
  employeeId = r.insertId;

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM users WHERE id = :id', { id: employeeId });
  await teardown(fx.tenantId);
  await closePool();
});

const jsonHeaders = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
  'Content-Type': 'application/json',
});

test('PATCH /api/employees/:id — email: null (champ laissé vide) accepté, email reste absent', async () => {
  const res = await fetch(`${baseUrl}/api/employees/${employeeId}`, {
    method: 'PATCH',
    headers: jsonHeaders(fx.dgId, fx.tenantId),
    body: JSON.stringify({ email: null, permissions: ['biens_a_vendre'] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.employee.email, null);
  assert.deepEqual(body.employee.permissions, ['biens_a_vendre']);
});

test('PATCH /api/employees/:id — email valide accepté, puis effacé avec null', async () => {
  const withEmail = await fetch(`${baseUrl}/api/employees/${employeeId}`, {
    method: 'PATCH',
    headers: jsonHeaders(fx.dgId, fx.tenantId),
    body: JSON.stringify({ email: 'sans.email@example.com' }),
  });
  assert.equal(withEmail.status, 200);
  const withEmailBody = await withEmail.json();
  assert.equal(withEmailBody.employee.email, 'sans.email@example.com');

  const cleared = await fetch(`${baseUrl}/api/employees/${employeeId}`, {
    method: 'PATCH',
    headers: jsonHeaders(fx.dgId, fx.tenantId),
    body: JSON.stringify({ email: null }),
  });
  assert.equal(cleared.status, 200);
  const clearedBody = await cleared.json();
  assert.equal(clearedBody.employee.email, null);
});

test('PATCH /api/employees/:id — email invalide toujours rejeté (400)', async () => {
  const res = await fetch(`${baseUrl}/api/employees/${employeeId}`, {
    method: 'PATCH',
    headers: jsonHeaders(fx.dgId, fx.tenantId),
    body: JSON.stringify({ email: 'pas-un-email' }),
  });
  assert.equal(res.status, 400);
});

test('PATCH /api/employees/:id — email omis (clé absente) ne touche pas l’email existant', async () => {
  await fetch(`${baseUrl}/api/employees/${employeeId}`, {
    method: 'PATCH',
    headers: jsonHeaders(fx.dgId, fx.tenantId),
    body: JSON.stringify({ email: 'garde.moi@example.com' }),
  });

  const res = await fetch(`${baseUrl}/api/employees/${employeeId}`, {
    method: 'PATCH',
    headers: jsonHeaders(fx.dgId, fx.tenantId),
    body: JSON.stringify({ firstName: 'Sans (renommé)' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.employee.email, 'garde.moi@example.com', 'email inchangé, clé absente du PATCH');
  assert.equal(body.employee.firstName, 'Sans (renommé)');
});
