'use strict';

/**
 * Archive des locataires (demande utilisateur, 2026-10-18) : `GET /api/renters` reste inchangé pour
 * un locataire avec bail actif, mais expose désormais `lastEndedLease` (dernier bail TERMINÉ, le plus
 * récent par `end_date`) pour permettre à l'écran de lister utilement un locataire parti — voir
 * `routes/renters.js`.
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
});

test('GET /api/renters — bail actif : activeLease renseigné, lastEndedLease toujours null', async () => {
  const res = await fetch(`${baseUrl}/api/renters`, { headers: bearer(fx.dgId, fx.tenantId) });
  assert.equal(res.status, 200);
  const body = await res.json();
  const row = body.renters.find((r) => r.id === fx.renterId);
  assert.ok(row.activeLease);
  assert.equal(row.lastEndedLease, null);
});

test('GET /api/renters — bail terminé : activeLease null, lastEndedLease renseigné (unité/propriétaire/loyer/date)', async () => {
  await pool.query("UPDATE leases SET status = 'ended', end_date = '2026-09-30' WHERE id = :id", { id: fx.leaseId });

  const res = await fetch(`${baseUrl}/api/renters`, { headers: bearer(fx.dgId, fx.tenantId) });
  assert.equal(res.status, 200);
  const body = await res.json();
  const row = body.renters.find((r) => r.id === fx.renterId);
  assert.equal(row.activeLease, null);
  assert.ok(row.lastEndedLease);
  assert.equal(row.lastEndedLease.unitCode, 'U1');
  assert.equal(row.lastEndedLease.ownerName, 'Propriétaire Test');
  assert.equal(row.lastEndedLease.monthlyRent, 50000);
  assert.equal(row.lastEndedLease.endDate, '2026-09-30');
});

test('GET /api/renters — plusieurs baux terminés : lastEndedLease reflète le plus RÉCENT par end_date, pas le premier créé', async () => {
  // Seconde unité + second bail, terminé AVANT le premier (déjà mis à 2026-09-30 ci-dessus) — doit
  // rester ignoré : le plus récent doit continuer à ressortir.
  const [unit2] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:tenantId, :propertyId, 'U2', 'studio', 'libre', 30000, :by)",
    { tenantId: fx.tenantId, propertyId: fx.propertyId, by: fx.dgId },
  );
  const [lease2] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, end_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:tenantId, :renterId, :unitId, '2026-01-01', '2026-06-30', 30000, 5, 0, 'ended', :by)",
    { tenantId: fx.tenantId, renterId: fx.renterId, unitId: unit2.insertId, by: fx.dgId },
  );

  const res = await fetch(`${baseUrl}/api/renters`, { headers: bearer(fx.dgId, fx.tenantId) });
  const body = await res.json();
  const row = body.renters.find((r) => r.id === fx.renterId);
  assert.equal(row.lastEndedLease.unitCode, 'U1', 'doit rester le bail terminé le plus récemment (2026-09-30), pas U2 (2026-06-30)');

  await pool.query('DELETE FROM leases WHERE id = :id', { id: lease2.insertId });
  await pool.query('DELETE FROM property_units WHERE id = :id', { id: unit2.insertId });
});
