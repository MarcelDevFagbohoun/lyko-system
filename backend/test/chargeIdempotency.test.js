'use strict';

/**
 * Bug corrigé (signalé par l'utilisateur, 2026-10-17) : la création d'une facture SONEB/SBEE
 * (`POST /api/charges`) était la seule écriture financière sans clé d'idempotence — un double-clic
 * sur « Enregistrer la facture » créait deux factures identiques. Ce test reproduit exactement ce
 * scénario via le vrai serveur HTTP (deux requêtes avec la MÊME clé), comme les autres tests de ce
 * dossier (voir monthClosingAudit.test.js).
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

function chargePayload(idempotencyKey) {
  return {
    leaseId: fx.leaseId,
    utilityType: 'soneb',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    readingStart: 100,
    readingEnd: 150,
    unitPrice: 500,
    billedAt: '2026-10-05',
    idempotencyKey,
  };
}

test(
  'POST /api/charges — un double-clic (même clé d\'idempotence) ne crée la facture qu\'une seule fois ; ' +
    'la seconde requête est refusée (409), sans doublon en base',
  async () => {
    const key = 'd1d2d3d4-e5f6-4789-a012-3456789abcde';

    const first = await fetch(`${baseUrl}/api/charges`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify(chargePayload(key)),
    });
    assert.equal(first.status, 201);
    const firstBody = await first.json();

    const second = await fetch(`${baseUrl}/api/charges`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify(chargePayload(key)),
    });
    assert.equal(second.status, 409);

    const [rows] = await pool.query('SELECT id FROM utility_charges WHERE tenant_id = :t AND lease_id = :l', {
      t: fx.tenantId,
      l: fx.leaseId,
    });
    assert.equal(rows.length, 1, 'une seule facture doit exister, pas deux');
    assert.equal(rows[0].id, firstBody.chargeId);
  },
);

test(
  'POST /api/charges — deux requêtes avec des clés DIFFÉRENTES créent bien deux factures distinctes (pas de faux positif)',
  async () => {
    const first = await fetch(`${baseUrl}/api/charges`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify(chargePayload('e1e2e3e4-e5f6-4789-a012-3456789abcde')),
    });
    assert.equal(first.status, 201);

    const second = await fetch(`${baseUrl}/api/charges`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify(chargePayload('f1f2f3f4-e5f6-4789-a012-3456789abcde')),
    });
    assert.equal(second.status, 201);
  },
);
