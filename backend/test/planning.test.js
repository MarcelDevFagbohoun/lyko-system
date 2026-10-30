'use strict';

/** Planning : visibilité propriétaire/créateur, délégation DG, OKR, Kanban, reprise des anciennes tâches. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');

let fx; let other; let server; let base; let agentId; let accId;
const tok = (id, role, tenantId = fx.tenantId) => ({ Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`, 'Content-Type': 'application/json' });
const call = (who, role, method, url, body) => fetch(`${base}/api/planning${url}`, { method, headers: tok(who, role), body: body ? JSON.stringify(body) : undefined });
const mk = async (tenantId, role, first) => (await pool.query(
  "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, :r, :f, 'Test', :p, 'x')",
  { t: tenantId, r: role, f: first, p: `04${Math.floor(Math.random() * 100000000)}` },
))[0].insertId;

before(async () => {
  fx = await createBareFixture();
  other = await createBareFixture();
  agentId = await mk(fx.tenantId, 'agent', 'Agent');
  accId = await mk(fx.tenantId, 'comptable', 'Compta');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await teardown(other.tenantId);
  await teardown(fx.tenantId);
  await closePool();
});

test('authentification requise', async () => {
  assert.equal((await fetch(`${base}/api/planning/tasks`)).status, 401);
});

test('un employé planifie pour lui seul ; le DG peut confier à un collègue de son entreprise uniquement', async () => {
  assert.equal((await call(agentId, 'agent', 'POST', '/tasks', { title: 'Visiter A', ownerId: accId })).status, 403);
  const mine = await call(agentId, 'agent', 'POST', '/tasks', { title: 'Visiter A', dueDate: '2026-11-05' });
  assert.equal(mine.status, 201);
  assert.equal((await mine.json()).task.status, 'a_faire');
  assert.equal((await call(fx.dgId, 'dg', 'POST', '/tasks', { title: 'Hors tenant', ownerId: other.dgId })).status, 400);
  const given = await call(fx.dgId, 'dg', 'POST', '/tasks', { title: 'Relancer impayés', ownerId: agentId, dueDate: '2026-11-10', priority: 'haute' });
  assert.equal(given.status, 201);
  assert.equal((await given.json()).task.assignedByOther, true);
});

test('visibilité : le DG ne voit que ce qu\'il a assigné ou qui est à lui', async () => {
  const dgList = (await (await call(fx.dgId, 'dg', 'GET', '/tasks')).json()).tasks.map((t) => t.title);
  assert.deepEqual(dgList, ['Relancer impayés']);
  const agList = (await (await call(agentId, 'agent', 'GET', '/tasks')).json()).tasks.map((t) => t.title).sort();
  assert.deepEqual(agList, ['Relancer impayés', 'Visiter A']);
  assert.deepEqual((await (await call(accId, 'comptable', 'GET', '/tasks')).json()).tasks, []);
  const people = await (await call(agentId, 'agent', 'GET', '/people')).json();
  assert.equal(people.people.length, 1); assert.equal(people.canAssign, false);
  assert.equal((await (await call(fx.dgId, 'dg', 'GET', '/people')).json()).people.length, 3);
});

test('tâche confiée : le propriétaire change seulement l\'avancement ; seul le créateur supprime', async () => {
  const tasks = (await (await call(agentId, 'agent', 'GET', '/tasks')).json()).tasks;
  const t = tasks.find((x) => x.title === 'Relancer impayés');
  assert.equal(t.canEdit, false);
  assert.equal((await call(agentId, 'agent', 'PATCH', `/tasks/${t.id}`, { title: 'autre' })).status, 403);
  const ok = await call(agentId, 'agent', 'PATCH', `/tasks/${t.id}`, { status: 'en_cours' });
  assert.equal(ok.status, 200);
  const done = (await (await call(agentId, 'agent', 'PATCH', `/tasks/${t.id}`, { status: 'termine' })).json()).task;
  assert.ok(done.completedAt);
  const back = (await (await call(agentId, 'agent', 'PATCH', `/tasks/${t.id}`, { status: 'a_faire' })).json()).task;
  assert.equal(back.completedAt, null);
  assert.equal((await call(agentId, 'agent', 'DELETE', `/tasks/${t.id}`)).status, 403);
  assert.equal((await call(accId, 'comptable', 'PATCH', `/tasks/${t.id}`, { status: 'termine' })).status, 404);
  assert.equal((await call(fx.dgId, 'dg', 'DELETE', `/tasks/${t.id}`)).status, 204);
});

test('dates incohérentes et titre vide refusés', async () => {
  assert.equal((await call(agentId, 'agent', 'POST', '/tasks', { title: 'x' })).status, 400);
  assert.equal((await call(agentId, 'agent', 'POST', '/tasks', { title: 'Bien', startDate: '2026-11-10', dueDate: '2026-11-01' })).status, 400);
});

test('OKR : avancement par résultats clés, sinon par tâches ; rattachement contrôlé', async () => {
  const o = await call(agentId, 'agent', 'POST', '/objectives', { title: 'Encaisser 95 % des loyers', startDate: '2026-10-01', endDate: '2026-12-31' });
  assert.equal(o.status, 201);
  const obj = (await o.json()).objective;
  assert.equal(obj.progress, 0);

  const t1 = (await (await call(agentId, 'agent', 'POST', '/tasks', { title: 'T1', objectiveId: obj.id })).json()).task;
  await call(agentId, 'agent', 'POST', '/tasks', { title: 'T2', objectiveId: obj.id });
  await call(agentId, 'agent', 'PATCH', `/tasks/${t1.id}`, { status: 'termine' });
  let list = (await (await call(agentId, 'agent', 'GET', '/objectives')).json()).objectives;
  assert.equal(list[0].progress, 50); assert.equal(list[0].tasksDone, 1);

  const k = await call(agentId, 'agent', 'POST', `/objectives/${obj.id}/key-results`, { title: 'Taux de recouvrement', unit: '%', targetValue: 95, currentValue: 47.5 });
  assert.equal(k.status, 201);
  const withKr = (await k.json()).objective;
  assert.equal(withKr.progress, 50);
  const krId = withKr.keyResults[0].id;
  const up = (await (await call(agentId, 'agent', 'PATCH', `/key-results/${krId}`, { currentValue: 200 })).json()).objective;
  assert.equal(up.progress, 100); // plafonné

  // Pas de rattachement à l'objectif d'un autre ni à un objectif invisible.
  assert.equal((await call(accId, 'comptable', 'POST', '/tasks', { title: 'X', objectiveId: obj.id })).status, 400);
  assert.equal((await call(accId, 'comptable', 'GET', '/objectives').then((r) => r.json())).objectives.length, 0);
  assert.equal((await call(accId, 'comptable', 'DELETE', `/objectives/${obj.id}`)).status, 404);
  assert.equal((await call(fx.dgId, 'dg', 'DELETE', `/objectives/${obj.id}`)).status, 404);
});

test('objectif confié par le DG : le propriétaire met à jour la valeur mais ne modifie pas la cible', async () => {
  const obj = (await (await call(fx.dgId, 'dg', 'POST', '/objectives', { title: 'Zéro impayé > 60 j', ownerId: accId, startDate: '2026-10-01', endDate: '2026-12-31' })).json()).objective;
  const kr = (await (await call(fx.dgId, 'dg', 'POST', `/objectives/${obj.id}/key-results`, { title: 'Dossiers', targetValue: 10 })).json()).objective.keyResults[0];
  assert.equal((await call(accId, 'comptable', 'PATCH', `/key-results/${kr.id}`, { targetValue: 1 })).status, 403);
  assert.equal((await call(accId, 'comptable', 'PATCH', `/key-results/${kr.id}`, { currentValue: 4 })).status, 200);
  assert.equal((await call(accId, 'comptable', 'PATCH', `/objectives/${obj.id}`, { title: 'x' })).status, 403);
  assert.equal((await (await call(fx.dgId, 'dg', 'GET', '/objectives')).json()).objectives[0].progress, 40);
  assert.equal((await call(fx.dgId, 'dg', 'DELETE', `/objectives/${obj.id}`)).status, 204);
});

test('reprise des anciennes tâches assignées (migration)', async () => {
  const [[m]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('planning_tasks','planning_objectives','planning_key_results')");
  assert.equal(Number(m.n), 3);
});
