'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');

let fx; let server; let base;
const hdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}`, 'Content-Type': 'application/json' });

before(async () => {
  fx = await createFixture();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM entity_notes WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

test('fil de notes : ajout, plus récente en premier, auteur et date', async () => {
  for (const body of ['Première note', 'Deuxième note']) {
    const r = await fetch(`${base}/api/notes`, { method: 'POST', headers: hdr(), body: JSON.stringify({ entityType: 'owner', entityId: fx.ownerId, body }) });
    assert.equal(r.status, 201);
  }
  const res = await fetch(`${base}/api/notes?entityType=owner&entityId=${fx.ownerId}`, { headers: hdr() });
  const { notes } = await res.json();
  assert.equal(notes.length, 2);
  assert.equal(notes[0].body, 'Deuxième note');
  assert.ok(notes[0].createdAt);
  assert.equal(notes[0].author.role, 'dg');
});

test('note vide ou élément inconnu refusés', async () => {
  const bad = await fetch(`${base}/api/notes`, { method: 'POST', headers: hdr(), body: JSON.stringify({ entityType: 'owner', entityId: fx.ownerId, body: '  ' }) });
  assert.equal(bad.status, 400);
  const nf = await fetch(`${base}/api/notes?entityType=renter&entityId=999999999`, { headers: hdr() });
  assert.equal(nf.status, 404);
});
