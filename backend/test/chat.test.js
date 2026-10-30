'use strict';

/** Discussion interne : cloisonnement un-à-un, édition/suppression par l'auteur, coches « lu », pièces jointes. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');

let fx; let server; let base; let agentId; let accId; let outsiderId; let outsiderTenant;
const tok = (id, role, tenantId = fx.tenantId) => ({ Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}` });
const J = { 'Content-Type': 'application/json' };
const mkUser = async (tenantId, role, first) => (await pool.query(
  "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, :r, :f, 'Test', :p, 'x')",
  { t: tenantId, r: role, f: first, p: `03${Math.floor(Math.random() * 100000000)}` },
))[0].insertId;
const send = (from, role, to, text) => fetch(`${base}/api/chat/conversations/${to}/messages`, {
  method: 'POST', headers: { ...tok(from, role), ...J }, body: JSON.stringify({ body: text }),
});

before(async () => {
  fx = await createBareFixture();
  agentId = await mkUser(fx.tenantId, 'agent', 'Agent');
  accId = await mkUser(fx.tenantId, 'comptable', 'Compta');
  const other = await createBareFixture();
  outsiderTenant = other.tenantId; outsiderId = other.dgId; fx.other = other;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await teardown(outsiderTenant);
  await teardown(fx.tenantId);
  await closePool();
});

test('authentification requise ; on ne parle pas à soi-même ni à une autre entreprise', async () => {
  assert.equal((await fetch(`${base}/api/chat/conversations`)).status, 401);
  assert.equal((await send(fx.dgId, 'dg', fx.dgId, 'moi')).status, 404);
  assert.equal((await send(fx.dgId, 'dg', outsiderId, 'intrus')).status, 404);
});

test('envoi, lecture, compteur de non lus et coches « lu »', async () => {
  const r = await send(fx.dgId, 'dg', agentId, 'Bonjour 👋');
  assert.equal(r.status, 201);
  const msg = (await r.json()).message;
  assert.equal(msg.body, 'Bonjour 👋');

  const unread = await (await fetch(`${base}/api/chat/unread-count`, { headers: tok(agentId, 'agent') })).json();
  assert.equal(unread.count, 1);
  const list = await (await fetch(`${base}/api/chat/conversations`, { headers: tok(agentId, 'agent') })).json();
  assert.equal(list.conversations[0].name, 'DG Test');
  assert.equal(list.conversations[0].unread, 1);
  assert.equal(list.unreadTotal, 1);

  // Avant lecture : pas lu côté expéditeur.
  let thread = await (await fetch(`${base}/api/chat/conversations/${agentId}/messages`, { headers: tok(fx.dgId, 'dg') })).json();
  assert.equal(thread.peerLastReadId < msg.id, true);
  // L'agent ouvre la conversation → lu.
  await fetch(`${base}/api/chat/conversations/${fx.dgId}/messages`, { headers: tok(agentId, 'agent') });
  thread = await (await fetch(`${base}/api/chat/conversations/${agentId}/messages`, { headers: tok(fx.dgId, 'dg') })).json();
  assert.equal(thread.peerLastReadId >= msg.id, true);
  assert.equal((await (await fetch(`${base}/api/chat/unread-count`, { headers: tok(agentId, 'agent') })).json()).count, 0);
});

test('le DG ne lit pas les conversations des autres', async () => {
  await send(agentId, 'agent', accId, 'secret agent→compta');
  const dgView = await (await fetch(`${base}/api/chat/conversations/${accId}/messages`, { headers: tok(fx.dgId, 'dg') })).json();
  assert.equal(dgView.messages.length, 0);
  const [m] = (await pool.query('SELECT id FROM chat_messages WHERE body = :b', { b: 'secret agent→compta' }))[0];
  assert.equal((await fetch(`${base}/api/chat/attachments/${m.id}`, { headers: tok(fx.dgId, 'dg') })).status, 404);
  assert.equal((await fetch(`${base}/api/chat/messages/${m.id}`, { method: 'DELETE', headers: tok(fx.dgId, 'dg') })).status, 404);
});

test('modification et suppression : auteur uniquement', async () => {
  const msg = (await (await send(fx.dgId, 'dg', accId, 'à modifier')).json()).message;
  const edit = (who, role, text) => fetch(`${base}/api/chat/messages/${msg.id}`, { method: 'PATCH', headers: { ...tok(who, role), ...J }, body: JSON.stringify({ body: text }) });
  assert.equal((await edit(accId, 'comptable', 'piraté')).status, 403);
  const ok = await edit(fx.dgId, 'dg', 'modifié');
  assert.equal(ok.status, 200);
  const m2 = (await ok.json()).message;
  assert.equal(m2.body, 'modifié'); assert.ok(m2.editedAt);
  assert.equal((await fetch(`${base}/api/chat/messages/${msg.id}`, { method: 'DELETE', headers: tok(accId, 'comptable') })).status, 403);
  assert.equal((await fetch(`${base}/api/chat/messages/${msg.id}`, { method: 'DELETE', headers: tok(fx.dgId, 'dg') })).status, 204);
  const thread = await (await fetch(`${base}/api/chat/conversations/${accId}/messages`, { headers: tok(fx.dgId, 'dg') })).json();
  const gone = thread.messages.find((x) => x.id === msg.id);
  assert.equal(gone.deleted, true); assert.equal(gone.body, null);
  assert.equal((await fetch(`${base}/api/chat/messages/${msg.id}`, { method: 'PATCH', headers: { ...tok(fx.dgId, 'dg'), ...J }, body: '{"body":"x"}' })).status, 409);
});

test('message vide ou trop long refusé', async () => {
  assert.equal((await send(fx.dgId, 'dg', agentId, '   ')).status, 400);
  assert.equal((await send(fx.dgId, 'dg', agentId, 'x'.repeat(4001))).status, 400);
});

test('pièces jointes : contenu réel contrôlé, accès aux seuls participants, pas via /api/files', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const up = async (buf, name, type) => {
    const fd = new FormData();
    fd.append('body', 'voir pièce');
    fd.append('file', new Blob([buf], { type }), name);
    return fetch(`${base}/api/chat/conversations/${agentId}/messages`, { method: 'POST', headers: tok(fx.dgId, 'dg'), body: fd });
  };
  assert.equal((await up(Buffer.from('MZ-exe-déguisé-en-image......'), 'virus.png', 'image/png')).status, 400);
  const ok = await up(png, 'photo été.png', 'image/png');
  assert.equal(ok.status, 201);
  const att = (await ok.json()).message.attachment;
  assert.equal(att.isImage, true); assert.equal(att.name, 'photo été.png');

  const url = `${base}${att.url}`;
  assert.equal((await fetch(url, { headers: tok(agentId, 'agent') })).status, 200);
  assert.equal((await fetch(url, { headers: tok(accId, 'comptable') })).status, 404);
  const [row] = (await pool.query('SELECT attachment_path FROM chat_messages WHERE attachment_path IS NOT NULL ORDER BY id DESC LIMIT 1'))[0];
  assert.equal((await fetch(`${base}/api/files/${row.attachment_path}`, { headers: tok(fx.dgId, 'dg') })).status, 404);

  // Suppression : le fichier n'est plus servi.
  const id = att.url.split('/').pop();
  await fetch(`${base}/api/chat/messages/${id}`, { method: 'DELETE', headers: tok(fx.dgId, 'dg') });
  assert.equal((await fetch(url, { headers: tok(agentId, 'agent') })).status, 404);
});
