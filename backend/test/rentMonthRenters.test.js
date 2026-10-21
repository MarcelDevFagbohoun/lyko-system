'use strict';

/**
 * Point financier de chaque locataire sur un mois (demande utilisateur, 2026-10-18 : « lorsqu'un
 * mois est clôturé on doit avoir, lorsqu'on clique sur le mois clôturé, le point financier de chaque
 * locataire dans ce mois-là ») — `GET /api/accounting/rent-month/:month/renters`, voir
 * `services/rentTracking.js` `listRentMonthRenters`.
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

test('GET /api/accounting/rent-month/:month/renters — mois invalide (400)', async () => {
  const res = await fetch(`${baseUrl}/api/accounting/rent-month/2026-13/renters`, {
    headers: bearer(fx.dgId, fx.tenantId),
  });
  assert.equal(res.status, 400);
});

test('GET /api/accounting/rent-month/:month/renters — une ligne par locataire suivi ce mois-là, avec identité et statut', async () => {
  await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-01', '2026-01-01', 50000, 'virement', '2026-01-05', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );

  const res = await fetch(`${baseUrl}/api/accounting/rent-month/2026-01/renters`, {
    headers: bearer(fx.dgId, fx.tenantId),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.month, '2026-01');
  assert.equal(body.renters.length, 1);

  const row = body.renters[0];
  assert.equal(row.leaseId, fx.leaseId);
  assert.equal(row.renterId, fx.renterId);
  assert.equal(row.renterName, 'Locataire Test');
  assert.equal(row.unitLabel, 'Studio (U1)');
  assert.equal(row.propertyLabel, 'GLT-001 · Adresse test');
  assert.equal(row.monthlyRent, 50000);
  assert.equal(row.paid, 50000);
  assert.equal(row.remaining, 0);
  assert.equal(row.status, 'paye');
});

test('GET /api/accounting/rent-month/:month/renters — plusieurs locataires, triés du plus préoccupant au moins préoccupant', async () => {
  const [renter2] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:tenantId, 'Deuxième', 'Locataire', :phone, :by)",
    { tenantId: fx.tenantId, phone: `04${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [unit2] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:tenantId, :propertyId, 'U2', 'studio', 'loue', 40000, :by)",
    { tenantId: fx.tenantId, propertyId: fx.propertyId, by: fx.dgId },
  );
  const [lease2] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, created_at, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:tenantId, :renterId, :unitId, '2026-01-01', '2026-01-01', 40000, 5, 0, 'active', :by)",
    { tenantId: fx.tenantId, renterId: renter2.insertId, unitId: unit2.insertId, by: fx.dgId },
  );
  // Rien payé pour ce second locataire en janvier → en retard (échéance du 5 déjà passée pour ce mois).

  const res = await fetch(`${baseUrl}/api/accounting/rent-month/2026-01/renters`, {
    headers: bearer(fx.dgId, fx.tenantId),
  });
  const body = await res.json();
  assert.equal(body.renters.length, 2);
  assert.deepEqual(body.renters.map((r) => r.status), ['en_retard', 'paye'], 'le plus préoccupant (en retard) en premier');
  assert.equal(body.renters[0].renterName, 'Deuxième Locataire');

  await pool.query('DELETE FROM leases WHERE id = :id', { id: lease2.insertId });
  await pool.query('DELETE FROM property_units WHERE id = :id', { id: unit2.insertId });
  await pool.query('DELETE FROM renters WHERE id = :id', { id: renter2.insertId });
});
