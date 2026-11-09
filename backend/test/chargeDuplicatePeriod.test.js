'use strict';

/**
 * Règle métier (demande utilisateur, 2026-11-09) : la période d'une facture SONEB/SBEE se choisit
 * désormais par mois calendaire (sélecteur Mois/Année côté client, voir `nouveau-view.tsx`), et on ne
 * peut plus enregistrer deux fois la même période pour le même bail et le même fluide. Ce test couvre
 * la règle serveur (`utilityCharges.assertNoDuplicatePeriod`), indépendante de l'idempotence (qui, elle,
 * ne protège que contre un double-clic avec la MÊME clé — voir chargeIdempotency.test.js).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;
let server;
let baseUrl;

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
  'Content-Type': 'application/json',
});

function chargePayload(overrides = {}) {
  return {
    leaseId: fx.leaseId,
    utilityType: 'soneb',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    readingStart: 0,
    readingEnd: 20,
    unitPrice: 300,
    billedAt: '2026-11-09',
    idempotencyKey: '11111111-1111-4111-a111-111111111111',
    ...overrides,
  };
}

test('POST /api/charges — une 2e facture du même fluide pour le même bail et le même mois est refusée (409)', async () => {
  const first = await fetch(`${baseUrl}/api/charges`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify(chargePayload()),
  });
  assert.equal(first.status, 201);

  const second = await fetch(`${baseUrl}/api/charges`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify(
      chargePayload({ idempotencyKey: '22222222-2222-4222-a222-222222222222', readingStart: 20, readingEnd: 40 }),
    ),
  });
  assert.equal(second.status, 409);
  const body = await second.json();
  assert.match(body.error, /existe déjà/i);
});

test('POST /api/charges — un autre fluide (SBEE) le même mois sur le même bail reste autorisé', async () => {
  const res = await fetch(`${baseUrl}/api/charges`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify(
      chargePayload({ utilityType: 'sbee', idempotencyKey: '33333333-3333-4333-a333-333333333333' }),
    ),
  });
  assert.equal(res.status, 201);
});

test('POST /api/charges — le même fluide un AUTRE mois sur le même bail reste autorisé', async () => {
  const res = await fetch(`${baseUrl}/api/charges`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify(
      chargePayload({
        periodStart: '2026-12-01',
        periodEnd: '2026-12-31',
        idempotencyKey: '44444444-4444-4444-a444-444444444444',
      }),
    ),
  });
  assert.equal(res.status, 201);
});

test('PATCH /api/charges/:id — corriger la période d\'une facture vers un mois déjà pris (même bail/fluide) est refusé (409)', async () => {
  // La facture SBEE de novembre (2e test) existe déjà ; on tente de faire glisser la facture SONEB de
  // décembre (3e test) vers novembre pour SONEB — ce mois-là est libre pour SONEB, donc ça doit passer,
  // puis on retente vers un mois réellement déjà pris pour SONEB (novembre, créé par le 1er test).
  const created = await fetch(`${baseUrl}/api/charges`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify(
      chargePayload({
        periodStart: '2027-01-01',
        periodEnd: '2027-01-31',
        idempotencyKey: '55555555-5555-4555-a555-555555555555',
      }),
    ),
  });
  assert.equal(created.status, 201);
  const { chargeId } = await created.json();

  const res = await fetch(`${baseUrl}/api/charges/${chargeId}`, {
    method: 'PATCH',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ periodStart: '2026-11-01', periodEnd: '2026-11-30' }),
  });
  assert.equal(res.status, 409);
});
