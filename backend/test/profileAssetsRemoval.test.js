'use strict';

/**
 * Suppression (pas seulement remplacement) de l'avatar, du cachet et de la signature — demande
 * utilisateur, 2026-10-30 : « il n'y a pas une possibilité de supprimer une signature ou cachet ».
 * Deux niveaux : personnel (`PATCH /api/auth/my-profile`, table `users`) et entreprise
 * (`PATCH /api/settings`, table `tenants`, DG uniquement). Voir routes/auth.js et routes/settings.js.
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

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

before(async () => {
  fx = await createBareFixture();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
});

test('PATCH /api/auth/my-profile — téléverse puis supprime le cachet et la signature personnels', async () => {
  const form = new FormData();
  form.append('stamp', new Blob([PNG_BYTES], { type: 'image/png' }), 'cachet.png');
  form.append('signature', new Blob([PNG_BYTES], { type: 'image/png' }), 'signature.png');
  const uploaded = await fetch(`${baseUrl}/api/auth/my-profile`, {
    method: 'PATCH',
    headers: bearer(fx.dgId, fx.tenantId),
    body: form,
  });
  assert.equal(uploaded.status, 200);

  const [[afterUpload]] = await pool.query('SELECT stamp_path, signature_path FROM users WHERE id = :id', { id: fx.dgId });
  assert.ok(afterUpload.stamp_path);
  assert.ok(afterUpload.signature_path);

  const removeForm = new FormData();
  removeForm.append('removeStamp', 'true');
  removeForm.append('removeSignature', 'true');
  const removed = await fetch(`${baseUrl}/api/auth/my-profile`, {
    method: 'PATCH',
    headers: bearer(fx.dgId, fx.tenantId),
    body: removeForm,
  });
  assert.equal(removed.status, 200);

  const [[afterRemoval]] = await pool.query('SELECT stamp_path, signature_path FROM users WHERE id = :id', { id: fx.dgId });
  assert.equal(afterRemoval.stamp_path, null);
  assert.equal(afterRemoval.signature_path, null);
});

test('PATCH /api/auth/my-profile — un nouveau fichier l’emporte sur une suppression demandée pour le même champ', async () => {
  const form = new FormData();
  form.append('avatar', new Blob([PNG_BYTES], { type: 'image/png' }), 'photo.png');
  form.append('removeAvatar', 'true');
  const res = await fetch(`${baseUrl}/api/auth/my-profile`, {
    method: 'PATCH',
    headers: bearer(fx.dgId, fx.tenantId),
    body: form,
  });
  assert.equal(res.status, 200);
  const [[row]] = await pool.query('SELECT avatar_path FROM users WHERE id = :id', { id: fx.dgId });
  assert.ok(row.avatar_path, 'le fichier téléversé doit être enregistré malgré removeAvatar=true');

  // Nettoyage pour ne pas polluer les tests suivants de cette fixture.
  await fetch(`${baseUrl}/api/auth/my-profile`, {
    method: 'PATCH',
    headers: bearer(fx.dgId, fx.tenantId),
    body: (() => {
      const f = new FormData();
      f.append('removeAvatar', 'true');
      return f;
    })(),
  });
});

test('PATCH /api/settings — téléverse puis supprime le cachet et la signature de l’entreprise (DG uniquement)', async () => {
  const form = new FormData();
  form.append('stamp', new Blob([PNG_BYTES], { type: 'image/png' }), 'cachet-entreprise.png');
  form.append('signature', new Blob([PNG_BYTES], { type: 'image/png' }), 'signature-entreprise.png');
  const uploaded = await fetch(`${baseUrl}/api/settings`, {
    method: 'PATCH',
    headers: bearer(fx.dgId, fx.tenantId),
    body: form,
  });
  assert.equal(uploaded.status, 200);

  const [[afterUpload]] = await pool.query('SELECT stamp_path, signature_path FROM tenants WHERE id = :id', { id: fx.tenantId });
  assert.ok(afterUpload.stamp_path);
  assert.ok(afterUpload.signature_path);

  const removeForm = new FormData();
  removeForm.append('removeStamp', 'true');
  removeForm.append('removeSignature', 'true');
  const removed = await fetch(`${baseUrl}/api/settings`, {
    method: 'PATCH',
    headers: bearer(fx.dgId, fx.tenantId),
    body: removeForm,
  });
  assert.equal(removed.status, 200);

  const [[afterRemoval]] = await pool.query('SELECT stamp_path, signature_path FROM tenants WHERE id = :id', { id: fx.tenantId });
  assert.equal(afterRemoval.stamp_path, null);
  assert.equal(afterRemoval.signature_path, null);
});

test('PATCH /api/settings — un rôle non-DG ne peut pas modifier le cachet/signature de l’entreprise', async () => {
  const form = new FormData();
  form.append('removeStamp', 'true');
  const res = await fetch(`${baseUrl}/api/settings`, {
    method: 'PATCH',
    headers: bearer(fx.dgId, fx.tenantId, 'agent'),
    body: form,
  });
  assert.equal(res.status, 403);
});
