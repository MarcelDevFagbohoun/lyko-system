'use strict';

/**
 * Suivi des erreurs dans le back-office (demande utilisateur, 2026-11-13) — services/errorTracker.js,
 * routes/admin.js (`/errors`), routes/clientErrors.js, middleware/error.js.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { errorHandler } = require('../src/middleware/error');
const { signAdminToken, signAccessToken } = require('../src/utils/jwt');
const { recordError, normalizePath } = require('../src/services/errorTracker');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx; let server; let baseUrl; let adminId;
const admin = () => ({ Authorization: `Bearer ${signAdminToken({ sub: adminId })}` });
const json = { 'Content-Type': 'application/json' };
const waitForRows = async (where, params = {}) => {
  // L'enregistrement depuis le gestionnaire d'erreurs HTTP est volontairement non bloquant.
  for (let i = 0; i < 40; i += 1) {
    const [rows] = await pool.query(`SELECT * FROM platform_error_events WHERE ${where}`, params);
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
  return [];
};

before(async () => {
  fx = await createBareFixture();
  const [a] = await pool.query(
    "INSERT INTO platform_admins (email, password_hash, name, status) VALUES (:e, 'x', 'Admin Test', 'active')",
    { e: `errors-${Date.now()}@test.local` },
  );
  adminId = a.insertId;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => pool.query('DELETE FROM platform_error_events'));
after(async () => {
  await new Promise((r) => server.close(r));
  await pool.query('DELETE FROM platform_error_events');
  await pool.query('DELETE FROM platform_admin_audit WHERE admin_id = :id', { id: adminId });
  await pool.query('DELETE FROM platform_admins WHERE id = :id', { id: adminId });
  await teardown(fx.tenantId);
  await closePool();
});

test('normalizePath — jamais d’identifiant, de jeton de portail ni de paramètre d’URL', () => {
  assert.equal(normalizePath('/api/renters/42/leases/7?phone=0161'), '/api/renters/:id/leases/:id');
  assert.equal(normalizePath('/api/portal/SecretTok3n/pay'), '/api/portal/:token/pay');
  assert.equal(normalizePath('/api/owner-portal/abc/statements/3'), '/api/owner-portal/:token/statements/:id');
});

test('recordError — la même erreur répétée incrémente le compteur au lieu de créer des lignes', async () => {
  const boom = (n) => recordError({ kind: 'job', error: new Error(`Loyer ${n} introuvable`), location: 'Relance du jour' });
  const id1 = await boom(12);
  const id2 = await boom(987); // seul le chiffre change : même erreur
  assert.equal(id1, id2);
  const [rows] = await pool.query('SELECT occurrences FROM platform_error_events');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].occurrences, 2);

  await recordError({ kind: 'job', error: new Error('Loyer 12 introuvable'), location: 'Autre tâche' });
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM platform_error_events');
  assert.equal(n, 2, 'un autre endroit = une autre erreur');
});

test('recordError — ne lève jamais, même avec une entrée invalide', async () => {
  assert.equal(await recordError({ kind: 'inconnu', error: new Error('x') }), null);
  assert.ok(await recordError({ kind: 'process', error: 'simple texte' }));
});

test('erreur 500 d’une requête — enregistrée avec la route normalisée et l’entreprise, sans donnée de la requête', async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/renters/:id/explode', (req, _res, next) => {
    req.user = { id: fx.dgId, tenantId: fx.tenantId };
    next(new Error('Panne simulée'));
  });
  app.use(errorHandler);
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/renters/42/explode?secret=abc`, {
    method: 'POST', headers: json, body: JSON.stringify({ phone: '0161234567' }),
  });
  assert.equal(res.status, 500);
  const [row] = await waitForRows("kind = 'api'");
  await new Promise((r) => s.close(r));
  assert.ok(row, 'la 500 doit apparaître dans le suivi');
  assert.equal(row.message, 'Panne simulée');
  assert.equal(row.location, 'POST /api/renters/:id/explode');
  assert.equal(row.tenant_id, fx.tenantId);
  assert.ok(!JSON.stringify(row).includes('0161234567') && !JSON.stringify(row).includes('abc'));
});

test('une erreur 4xx (refus normal) n’est jamais enregistrée', async () => {
  const res = await fetch(`${baseUrl}/api/renters`);
  assert.equal(res.status, 401);
  await new Promise((r) => setTimeout(r, 150));
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM platform_error_events');
  assert.equal(n, 0);
});

test('GET /api/admin/errors — réservé à l’administrateur plateforme (un DG client est refusé)', async () => {
  assert.equal((await fetch(`${baseUrl}/api/admin/errors`)).status, 401);
  const dg = { Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}` };
  assert.equal((await fetch(`${baseUrl}/api/admin/errors`, { headers: dg })).status, 401);
});

test('back-office — liste, « Corrigé », puis réouverture automatique si l’erreur revient', async () => {
  const id = await recordError({ kind: 'api', error: new Error('Panne A'), location: 'GET /api/x', tenantId: fx.tenantId });

  let body = await (await fetch(`${baseUrl}/api/admin/errors`, { headers: admin() })).json();
  assert.equal(body.openCount, 1);
  assert.equal(body.errors[0].message, 'Panne A');
  assert.ok(body.errors[0].companyName, 'le nom de l’entreprise touchée est affiché');

  const resolve = await fetch(`${baseUrl}/api/admin/errors/${id}/resolve`, { method: 'POST', headers: admin() });
  assert.equal(resolve.status, 200);
  body = await (await fetch(`${baseUrl}/api/admin/errors`, { headers: admin() })).json();
  assert.equal(body.openCount, 0);
  body = await (await fetch(`${baseUrl}/api/admin/errors?status=resolved`, { headers: admin() })).json();
  assert.equal(body.errors.length, 1);

  await recordError({ kind: 'api', error: new Error('Panne A'), location: 'GET /api/x', tenantId: fx.tenantId });
  body = await (await fetch(`${baseUrl}/api/admin/errors`, { headers: admin() })).json();
  assert.equal(body.openCount, 1, 'l’erreur revenue réapparaît dans la liste ouverte');
  assert.equal(body.errors[0].occurrences, 2);
});

test('POST /api/client-errors — un écran en erreur est enregistré ; une entrée invalide est ignorée sans erreur', async () => {
  const token = signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' });
  const ok = await fetch(`${baseUrl}/api/client-errors`, {
    method: 'POST',
    headers: { ...json, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: "Cannot read properties of undefined (reading 'map')", stack: 'at Page (app.js:1:1)', page: '/espace/locataires/42?tab=bail' }),
  });
  assert.equal(ok.status, 204);
  const [row] = await waitForRows("kind = 'frontend'");
  assert.equal(row.location, '/espace/locataires/:id');
  assert.equal(row.tenant_id, fx.tenantId);

  const bad = await fetch(`${baseUrl}/api/client-errors`, { method: 'POST', headers: json, body: JSON.stringify({ message: '' }) });
  assert.equal(bad.status, 204);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM platform_error_events');
  assert.equal(n, 1);
});
