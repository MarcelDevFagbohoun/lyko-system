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
  await pool.query('DELETE FROM note_sheets WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

test('fil de notes : ajout, plus récente en premier, auteur et date', async () => {
  for (const body of ['Première note', 'Deuxième note']) {
    const r = await fetch(`${base}/api/notes`, { method: 'POST', headers: hdr(), body: JSON.stringify({ entityType: 'property', entityId: fx.propertyId, body }) });
    assert.equal(r.status, 201);
  }
  const res = await fetch(`${base}/api/notes?entityType=property&entityId=${fx.propertyId}`, { headers: hdr() });
  const { notes } = await res.json();
  assert.equal(notes.length, 2);
  assert.equal(notes[0].body, 'Deuxième note');
  assert.ok(notes[0].createdAt);
  assert.equal(notes[0].author.role, 'dg');
});

test('note vide ou élément inconnu refusés', async () => {
  const bad = await fetch(`${base}/api/notes`, { method: 'POST', headers: hdr(), body: JSON.stringify({ entityType: 'property', entityId: fx.propertyId, body: '  ' }) });
  assert.equal(bad.status, 400);
  const nf = await fetch(`${base}/api/notes?entityType=renter&entityId=999999999`, { headers: hdr() });
  assert.equal(nf.status, 404);
});

const sheetGet = (type, id) => fetch(`${base}/api/notes/sheet?entityType=${type}&entityId=${id}`, { headers: hdr() });
const sheetPut = (body) => fetch(`${base}/api/notes/sheet`, { method: 'PUT', headers: hdr(), body: JSON.stringify(body) });

test('fiche de notes : vide au départ, enregistrement, version, auteur', async () => {
  let r = await sheetGet('renter', fx.renterId);
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.equal(j.sheet.content, '');
  assert.equal(j.sheet.version, 0);

  r = await sheetPut({ entityType: 'renter', entityId: fx.renterId, content: '## Paiement\n- Paie toujours avant le 5\n\n**À surveiller** : bruit', version: 0 });
  assert.equal(r.status, 200);
  j = await r.json();
  assert.equal(j.sheet.version, 1);
  assert.match(j.sheet.content, /Paie toujours/);
  assert.equal(j.sheet.updatedBy.role, 'dg');

  r = await sheetPut({ entityType: 'renter', entityId: fx.renterId, content: 'Version deux', version: 1 });
  assert.equal((await r.json()).sheet.version, 2);
  assert.equal((await (await sheetGet('renter', fx.renterId)).json()).sheet.content, 'Version deux');
});

test('fiche de notes : une modification simultanée est refusée sans rien écraser', async () => {
  const r = await sheetPut({ entityType: 'renter', entityId: fx.renterId, content: 'Écrasement obsolète', version: 1 }); // la version courante est 2
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.details.sheet.content, 'Version deux');
  assert.equal(j.details.sheet.version, 2);
  // deux créations simultanées de la fiche d'un propriétaire : la seconde est refusée
  assert.equal((await sheetPut({ entityType: 'owner', entityId: fx.ownerId, content: 'A', version: 0 })).status, 200);
  assert.equal((await sheetPut({ entityType: 'owner', entityId: fx.ownerId, content: 'B', version: 0 })).status, 409);
});

test('fiche de notes : validation, élément inconnu, bien non géré, et plus de nouveau message pour locataire/propriétaire', async () => {
  assert.equal((await sheetPut({ entityType: 'property', entityId: fx.propertyId, content: 'x', version: 0 })).status, 400);
  assert.equal((await sheetPut({ entityType: 'renter', entityId: fx.renterId, content: 'x'.repeat(20001), version: 2 })).status, 400);
  assert.equal((await sheetGet('renter', 999999999)).status, 404);
  const post = await fetch(`${base}/api/notes`, { method: 'POST', headers: hdr(), body: JSON.stringify({ entityType: 'renter', entityId: fx.renterId, body: 'nouveau message' }) });
  assert.equal(post.status, 400);
});

test('fiche de notes : les anciennes notes restent lisibles sous la fiche', async () => {
  await pool.query("INSERT INTO entity_notes (tenant_id, entity_type, entity_id, body, author_id) VALUES (:t, 'renter', :id, 'Ancienne note', :a)", { t: fx.tenantId, id: fx.renterId, a: fx.dgId });
  const j = await (await sheetGet('renter', fx.renterId)).json();
  assert.equal(j.legacyNotes.length, 1);
  assert.equal(j.legacyNotes[0].body, 'Ancienne note');
});
