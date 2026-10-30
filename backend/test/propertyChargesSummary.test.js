'use strict';

/**
 * Clarté du statut des charges SONEB/SBEE au niveau de chaque bien (demande utilisateur, 2026-10-30) :
 * `GET /api/charges/unpaid-by-property` agrège les factures non soldées par bien, et `GET /api/charges`
 * accepte désormais un filtre `propertyId`. Voir services/utilityCharges.js et routes/charges.js.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;
let otherPropertyId;
let server;
let baseUrl;

before(async () => {
  fx = await createBareFixture();

  // Un second bien du même tenant, avec sa propre unité/locataire/bail actif, pour vérifier que le
  // filtre propertyId isole bien un bien de l'autre.
  const [property] = await pool.query(
    'INSERT INTO properties (tenant_id, code, owner_id, address, created_by) VALUES (:tenantId, :code, :ownerId, :address, :by)',
    { tenantId: fx.tenantId, code: 'GLT-002', ownerId: fx.ownerId, address: 'Autre adresse', by: fx.dgId },
  );
  otherPropertyId = property.insertId;
  await pool.query(
    "INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on) VALUES (:tenantId, :propertyId, :ownerId, '2020-01-01')",
    { tenantId: fx.tenantId, propertyId: otherPropertyId, ownerId: fx.ownerId },
  );
  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:tenantId, :propertyId, 'U2', 'studio', 'loue', 50000, :by)",
    { tenantId: fx.tenantId, propertyId: otherPropertyId, by: fx.dgId },
  );
  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:tenantId, 'Autre', 'Locataire', :phone, :by)",
    { tenantId: fx.tenantId, phone: `04${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [lease] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:tenantId, :renterId, :unitId, '2026-01-01', 50000, 5, 50000, 'active', :by)",
    { tenantId: fx.tenantId, renterId: renter.insertId, unitId: unit.insertId, by: fx.dgId },
  );
  fx.otherLeaseId = lease.insertId;

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM properties WHERE id = :id', { id: otherPropertyId });
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
  'Content-Type': 'application/json',
});

async function createCharge(leaseId, readingStart, readingEnd) {
  const res = await fetch(`${baseUrl}/api/charges`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({
      leaseId,
      utilityType: 'soneb',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      readingStart,
      readingEnd,
      unitPrice: 500,
      billedAt: '2026-10-05',
    }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

test('GET /api/charges/unpaid-by-property — regroupe les factures non soldées par bien, ignore les factures réglées', async () => {
  // Bien 1 : une facture non réglée (25 000) + une facture réglée en totalité (10 000, exclue du total).
  const unpaid = await createCharge(fx.leaseId, 0, 50); // 50 * 500 = 25 000
  const toBePaid = await createCharge(fx.leaseId, 50, 70); // 20 * 500 = 10 000
  const payRes = await fetch(`${baseUrl}/api/charges/${toBePaid.chargeId}/payments`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: JSON.stringify({ amount: 10000, paymentMethod: 'especes', paidAt: '2026-10-06' }),
  });
  assert.equal(payRes.status, 201);

  // Bien 2 : une facture non réglée (5 000).
  await createCharge(fx.otherLeaseId, 0, 10); // 10 * 500 = 5 000

  const res = await fetch(`${baseUrl}/api/charges/unpaid-by-property`, { headers: bearer(fx.dgId, fx.tenantId) });
  assert.equal(res.status, 200);
  const { byProperty } = await res.json();

  const p1 = byProperty.find((r) => r.propertyId === fx.propertyId);
  assert.ok(p1, 'le bien 1 doit apparaître (il a une facture non soldée)');
  assert.equal(p1.unpaidCount, 1, 'la facture réglée ne doit pas compter');
  assert.equal(p1.totalDue, 25000);

  const p2 = byProperty.find((r) => r.propertyId === otherPropertyId);
  assert.ok(p2, 'le bien 2 doit apparaître');
  assert.equal(p2.unpaidCount, 1);
  assert.equal(p2.totalDue, 5000);
  assert.equal(unpaid.chargeId > 0, true);
});

test('GET /api/charges?propertyId= — isole les factures d’un bien, sans mélanger avec un autre bien du même tenant', async () => {
  const res = await fetch(`${baseUrl}/api/charges?propertyId=${fx.propertyId}`, { headers: bearer(fx.dgId, fx.tenantId) });
  assert.equal(res.status, 200);
  const { charges } = await res.json();
  assert.ok(charges.length >= 2, 'doit inclure les factures (réglées ou non) du bien 1');
  assert.ok(charges.every((c) => c.property.id === fx.propertyId), 'ne doit jamais inclure une facture d’un autre bien');
});
