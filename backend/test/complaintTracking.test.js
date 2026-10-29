'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');

let A; let B; let server; let base; let complaintId; let trackingPath;
const bearer = (fx) => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}`, 'Content-Type': 'application/json' });
const json = { 'Content-Type': 'application/json' };
const SECRET = 'SECRET-INTERNE-ne-jamais-montrer';
const token = () => trackingPath.split('/').pop();

before(async () => {
  A = await createBareFixture();
  B = await createBareFixture();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  for (const fx of [A, B]) await pool.query('DELETE FROM complaints WHERE tenant_id = :t', { t: fx.tenantId });
  for (const fx of [A, B]) await teardown(fx.tenantId);
  await closePool();
});

const post = (url, body, headers) => fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });

test('déclarer une plainte crée l\'événement « signalée » et le dossier renvoie dates + journal', async () => {
  const r = await post('/api/complaints', { leaseId: A.leaseId, category: 'plomberie', title: 'Fuite cuisine', priority: 'normale' }, bearer(A));
  assert.equal(r.status, 201);
  complaintId = (await r.json()).complaintId;
  const d = await (await fetch(`${base}/api/complaints/${complaintId}`, { headers: bearer(A) })).json();
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0].type, 'reported');
  assert.equal(d.events[0].author.role, 'dg');
  assert.ok(d.dates.reportedAt && d.dates.lastActivityAt);
  assert.equal(d.dates.resolvedAt, null);
});

test('commentaire équipe : interne par défaut, validations', async () => {
  let r = await post(`/api/complaints/${complaintId}/events`, { comment: SECRET }, bearer(A));
  assert.equal(r.status, 201);
  const j = await r.json();
  const c = j.events.find((e) => e.body === SECRET);
  assert.equal(c.visibility, 'internal');
  assert.equal(c.author.role, 'dg');
  assert.equal((await post(`/api/complaints/${complaintId}/events`, {}, bearer(A))).status, 400);
  assert.equal((await post(`/api/complaints/${complaintId}/events`, { comment: '   ' }, bearer(A))).status, 400);
  assert.equal((await post(`/api/complaints/${complaintId}/events`, { comment: 'x', visibility: 'public' }, bearer(A))).status, 400);
  assert.equal((await post(`/api/complaints/${complaintId}/events`, { comment: 'x'.repeat(2001) }, bearer(A))).status, 400);
  r = await post(`/api/complaints/${complaintId}/events`, { status: 'resolue' }, bearer(A));
  assert.equal(r.status, 400); // note de résolution requise
});

test('lien de suivi : stable, et la page publique ne montre jamais le contenu interne ni le nom de l\'équipe', async () => {
  const r1 = await (await post(`/api/complaints/${complaintId}/tracking-link`, {}, bearer(A))).json();
  const r2 = await (await post(`/api/complaints/${complaintId}/tracking-link`, {}, bearer(A))).json();
  assert.match(r1.path, /^\/suivi\/[A-Za-z0-9_-]{20,}$/);
  assert.equal(r1.path, r2.path);
  trackingPath = r1.path;

  await post(`/api/complaints/${complaintId}/events`, { comment: 'Plombier prévenu pour demain', visibility: 'tenant' }, bearer(A));

  const res = await fetch(`${base}/api/complaint-tracking/${token()}`);
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.ok(!raw.includes(SECRET), 'le commentaire interne a fuité');
  const view = JSON.parse(raw);
  const bodies = view.events.map((e) => e.body).filter(Boolean);
  assert.deepEqual(bodies, ['Plombier prévenu pour demain']);
  assert.ok(view.events.some((e) => e.type === 'reported' && e.toStatus === 'non_resolue'));
  assert.ok(view.events.every((e) => e.by === 'team' || e.by === 'tenant'));
  assert.ok(!('author' in view.events[0]));
  assert.equal(view.complaint.description, null); // saisie par l'équipe : non affichée
  assert.equal(view.complaint.status, 'non_resolue');
  assert.ok(view.dates.reportedAt);
  for (const k of ['lease', 'renter', 'tenantId', 'id', 'resolutionNote']) assert.ok(!(k in view.complaint), `champ ${k} exposé`);
});

test('réponse du locataire : visible de l\'équipe avec son nom, validations, jeton inconnu', async () => {
  let r = await post(`/api/complaint-tracking/${token()}/comments`, { message: 'Merci, je serai présent' }, json);
  assert.equal(r.status, 201);
  assert.ok((await r.json()).events.some((e) => e.by === 'tenant' && e.body === 'Merci, je serai présent'));
  const d = await (await fetch(`${base}/api/complaints/${complaintId}`, { headers: bearer(A) })).json();
  const mine = d.events.find((e) => e.body === 'Merci, je serai présent');
  assert.equal(mine.author.role, 'locataire');
  assert.equal(mine.visibility, 'tenant');

  assert.equal((await post(`/api/complaint-tracking/${token()}/comments`, { message: '  ' }, json)).status, 400);
  assert.equal((await post(`/api/complaint-tracking/${token()}/comments`, { message: 'x'.repeat(1001) }, json)).status, 400);
  assert.equal((await fetch(`${base}/api/complaint-tracking/${'a'.repeat(32)}`)).status, 404);
  assert.equal((await post(`/api/complaint-tracking/${'a'.repeat(32)}/comments`, { message: 'salut' }, json)).status, 404);
  assert.equal((await fetch(`${base}/api/complaint-tracking/court`)).status, 404);
});

test('limite de messages du locataire par heure', async () => {
  let last;
  for (let i = 0; i < 12; i += 1) last = await post(`/api/complaint-tracking/${token()}/comments`, { message: `msg ${i}` }, json);
  assert.equal(last.status, 429);
});

test('résolution : date de résolution, note de résolution jamais montrée au locataire', async () => {
  const r = await post(`/api/complaints/${complaintId}/events`, { status: 'resolue', resolutionNote: 'NOTE-RESOLUTION-INTERNE' }, bearer(A));
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.ok(j.dates.resolvedAt);
  const raw = await (await fetch(`${base}/api/complaint-tracking/${token()}`)).text();
  assert.ok(!raw.includes('NOTE-RESOLUTION-INTERNE'));
  assert.equal(JSON.parse(raw).complaint.status, 'resolue');
});

test('ancienne route de statut : mêmes événements ; réouverture, le locataire peut toujours répondre', async () => {
  const r = await fetch(`${base}/api/complaints/${complaintId}/status`, { method: 'PATCH', headers: bearer(A), body: JSON.stringify({ status: 'non_resolue' }) });
  assert.equal(r.status, 200);
  const d = await (await fetch(`${base}/api/complaints/${complaintId}`, { headers: bearer(A) })).json();
  assert.ok(d.events.some((e) => e.type === 'status_changed' && e.toStatus === 'non_resolue'));
  const view = await (await fetch(`${base}/api/complaint-tracking/${token()}`)).json();
  assert.equal(view.complaint.status, 'non_resolue');
  assert.equal(view.complaint.canComment, true); // plus de statut « fermée » : jamais de verrouillage
});

test('isolation entre entreprises : l\'autre entreprise ne voit ni le dossier, ni le journal, ni ne commente', async () => {
  assert.equal((await fetch(`${base}/api/complaints/${complaintId}`, { headers: bearer(B) })).status, 404);
  assert.equal((await post(`/api/complaints/${complaintId}/events`, { comment: 'intrusion' }, bearer(B))).status, 404);
  assert.equal((await post(`/api/complaints/${complaintId}/tracking-link`, {}, bearer(B))).status, 404);
});

test('portail : signalement renvoie le lien de suivi, la liste ne montre que SES réclamations', async () => {
  const link = await (await post(`/api/renters/${A.renterId}/portal-link`, {}, bearer(A))).json();
  const pr = await post(`/api/portal/${link.token}/complaints`, { category: 'electricite', title: 'Prise cassée', description: 'Étincelles', priority: 'normale' }, json);
  assert.equal(pr.status, 201);
  const created = await pr.json();
  assert.match(created.trackingPath, /^\/suivi\/.{20,}$/);

  const list = await (await fetch(`${base}/api/portal/${link.token}/complaints`)).json();
  assert.equal(list.complaints.length, 2);
  assert.ok(list.complaints.some((c) => c.code === created.code && c.trackingPath === created.trackingPath));

  const view = await (await fetch(`${base}/api${created.trackingPath.replace('/suivi/', '/complaint-tracking/')}`)).json();
  assert.equal(view.complaint.description, 'Étincelles'); // écrite par le locataire : visible
  assert.equal(view.events[0].type, 'reported');
  assert.equal(view.events[0].by, 'tenant');

  const linkB = await (await post(`/api/renters/${B.renterId}/portal-link`, {}, bearer(B))).json();
  const listB = await (await fetch(`${base}/api/portal/${linkB.token}/complaints`)).json();
  assert.equal(listB.complaints.length, 0);
});

test('registre : dernière activité et auteur du dernier échange', async () => {
  const { complaints } = await (await fetch(`${base}/api/complaints`, { headers: bearer(A) })).json();
  assert.ok(complaints.length >= 2);
  for (const c of complaints) assert.ok(c.lastActivityAt);
  const portalOne = complaints.find((c) => c.reportedViaPortal);
  assert.equal(portalOne.lastByTenant, true);
});
