'use strict';

/**
 * Archive des propriétaires (demande utilisateur, 2026-10-18) : un propriétaire quitte le cabinet
 * via une action VOLONTAIRE du DG (jamais automatique sur « 0 Bien »), motif obligatoire, bloquée
 * tant qu'il reste au moins un Bien rattaché. Sa fiche devient ensuite en LECTURE SEULE (décision
 * explicite) — `POST /:id/reactivate-mandate` est l'unique porte de sortie.
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
let emptyOwnerId; // propriétaire SANS aucun Bien — seul cas où mettre fin au mandat doit réussir.

before(async () => {
  fx = await createBareFixture();
  const [owner] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Propriétaire Sans Bien',
    by: fx.dgId,
  });
  emptyOwnerId = owner.insertId;

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM owners WHERE id = :id', { id: emptyOwnerId });
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
  'Content-Type': 'application/json',
});

test('POST /:id/end-mandate — refusé tant qu’au moins un Bien reste rattaché (409, message exact)', async () => {
  const res = await fetch(`${baseUrl}/api/owners/${fx.ownerId}/end-mandate`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ reason: 'Fin de la relation commerciale' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /encore 1 Bien rattaché — réattribuez-les d'abord/);

  const [rows] = await pool.query('SELECT mandate_ended_at FROM owners WHERE id = :id', { id: fx.ownerId });
  assert.equal(rows[0].mandate_ended_at, null, 'ne doit rien avoir changé en base');
});

test('POST /:id/end-mandate — motif trop court rejeté (400)', async () => {
  const res = await fetch(`${baseUrl}/api/owners/${emptyOwnerId}/end-mandate`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ reason: 'x' }),
  });
  assert.equal(res.status, 400);
});

test('POST /:id/end-mandate — refusé pour un rôle non-DG (403)', async () => {
  const res = await fetch(`${baseUrl}/api/owners/${emptyOwnerId}/end-mandate`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId, 'comptable'),
    body: JSON.stringify({ reason: 'Fin de la relation commerciale' }),
  });
  assert.equal(res.status, 403);
});

test('POST /:id/end-mandate — réussit pour un propriétaire sans Bien, motif/auteur/date enregistrés', async () => {
  const res = await fetch(`${baseUrl}/api/owners/${emptyOwnerId}/end-mandate`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ reason: 'Vend tout son patrimoine' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.owner.mandateEndedAt);
  assert.equal(body.owner.mandateEndReason, 'Vend tout son patrimoine');
  assert.equal(body.owner.mandateEndedBy.name, 'DG Test');
});

test('POST /:id/end-mandate — déjà terminé renvoie 409', async () => {
  const res = await fetch(`${baseUrl}/api/owners/${emptyOwnerId}/end-mandate`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ reason: 'Nouvelle tentative' }),
  });
  assert.equal(res.status, 409);
});

test('Fiche en lecture seule une fois le mandat terminé — PATCH /:id et POST /:id/payouts refusés (409)', async () => {
  const patch = await fetch(`${baseUrl}/api/owners/${emptyOwnerId}`, {
    method: 'PATCH',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ notes: 'Tentative sur fiche archivée' }),
  });
  assert.equal(patch.status, 409);

  const payout = await fetch(`${baseUrl}/api/owners/${emptyOwnerId}/payouts`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ amount: 1000, periodLabel: 'Test', paidAt: '2026-10-18', paymentMethod: 'especes' }),
  });
  assert.equal(payout.status, 409);

  const [payoutRows] = await pool.query('SELECT id FROM owner_payouts WHERE owner_id = :id', { id: emptyOwnerId });
  assert.equal(payoutRows.length, 0, 'aucun versement ne doit avoir été enregistré');
});

test('POST /:id/reactivate-mandate — refusé pour un propriétaire déjà actif (409)', async () => {
  const res = await fetch(`${baseUrl}/api/owners/${fx.ownerId}/reactivate-mandate`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
  });
  assert.equal(res.status, 409);
});

test('POST /:id/reactivate-mandate — réactive un propriétaire archivé, la fiche redevient actionnable', async () => {
  const reactivate = await fetch(`${baseUrl}/api/owners/${emptyOwnerId}/reactivate-mandate`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
  });
  assert.equal(reactivate.status, 200);
  const body = await reactivate.json();
  assert.equal(body.owner.mandateEndedAt, null);
  assert.equal(body.owner.mandateEndReason, null);

  const patch = await fetch(`${baseUrl}/api/owners/${emptyOwnerId}`, {
    method: 'PATCH',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ notes: 'De nouveau modifiable' }),
  });
  assert.equal(patch.status, 200);
});

test('GET /api/owners — expose mandateEndedAt/mandateEndedBy/mandateEndReason dans la liste', async () => {
  await fetch(`${baseUrl}/api/owners/${emptyOwnerId}/end-mandate`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ reason: 'Archivé pour le test de liste' }),
  });

  const res = await fetch(`${baseUrl}/api/owners`, { headers: bearer(fx.dgId, fx.tenantId) });
  assert.equal(res.status, 200);
  const body = await res.json();
  const row = body.owners.find((o) => o.id === emptyOwnerId);
  assert.ok(row);
  assert.ok(row.mandateEndedAt);
  assert.equal(row.mandateEndReason, 'Archivé pour le test de liste');

  const activeRow = body.owners.find((o) => o.id === fx.ownerId);
  assert.equal(activeRow.mandateEndedAt, null);
});
