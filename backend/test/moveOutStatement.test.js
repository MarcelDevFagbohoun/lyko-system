'use strict';

/**
 * (copie de l'en-tête) Arriérés de loyer réglés par la caution à la sortie (demande utilisateur, 2026-10-18) : un
 * locataire quittant en devant encore du loyer voyait jusqu'ici cette dette simplement
 * disparaître (`leases.status = 'ended'` exclut immédiatement le bail de `listPortfolioArrears`)
 * sans jamais être réglée — la caution ne protégeait que contre les dégradations. Voir
 * `routes/leases.js` `POST /:leaseId/move-out-report/finalize`, `services/rentTracking.js`
 * `computeRentOwed`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { cloneMasterZones } = require('../src/services/inspection');
const { listPortfolioArrears } = require('../src/services/rentTracking');
const { createBareFixture, createFixture, teardown } = require('./gl/fixtures');

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
function fakeSignatureForm(extra) {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  form.set('tenantSignature', new Blob([PNG_BYTES], { type: 'image/png' }), 'sig-locataire.png');
  form.set('agentSignature', new Blob([PNG_BYTES], { type: 'image/png' }), 'sig-agent.png');
  return form;
}

async function insertActiveLease(fx, { unitCode, depositAmount, monthlyRent = 40000, startDate = '2026-01-01', renterSuffix = '' }) {
  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, :code, 'studio', 'loue', :rent, :by)",
    { t: fx.tenantId, p: fx.propertyId, code: unitCode, rent: monthlyRent, by: fx.dgId },
  );
  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Sortie', :lastName, :phone, :by)",
    { t: fx.tenantId, lastName: `Arrears${renterSuffix}`, phone: `08${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [lease] = await pool.query(
    `INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, created_at, monthly_rent, rent_due_day, deposit_amount, status, created_by)
     VALUES (:t, :r, :u, :startDate, :startDate, :rent, 5, :depositAmount, 'active', :by)`,
    { t: fx.tenantId, r: renter.insertId, u: unit.insertId, startDate, rent: monthlyRent, depositAmount, by: fx.dgId },
  );
  return { leaseId: lease.insertId, unitId: unit.insertId, renterId: renter.insertId };
}

/** Fiche de sortie prête à finaliser : toutes les conditions à 'BE' (aucune retenue de dégradation). */
async function insertDraftMoveOutReport({ tenantId, leaseId, depositAmount, conductedAt, dgId, otherDeductionsAmount = 0 }) {
  const zones = cloneMasterZones();
  for (const zone of zones) for (const item of zone.items) item.condition = 'BE';
  const [result] = await pool.query(
    `INSERT INTO move_out_reports (tenant_id, lease_id, conducted_at, items, status, deposit_amount, other_deductions_amount, total_deductions, net_refund, conducted_by)
     VALUES (:t, :l, :conductedAt, :items, 'draft', :depositAmount, :otherDeductionsAmount, 0, :depositAmount, :by)`,
    { t: tenantId, l: leaseId, conductedAt, items: JSON.stringify({ zones }), depositAmount, otherDeductionsAmount, by: dgId },
  );
  return result.insertId;
}


let fx; let server; let baseUrl;
before(async () => {
  fx = await createBareFixture();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await teardown(fx.tenantId);
  await closePool();
});
const auth = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}` });

test('point de sortie : main-d’œuvre + loyers impayés > caution → solde négatif, résolution exigée, PDF', async () => {
  const { leaseId } = await insertActiveLease(fx, { unitCode: 'U-PT-1', depositAmount: 100000, monthlyRent: 40000, startDate: '2026-01-01' });
  await insertDraftMoveOutReport({ tenantId: fx.tenantId, leaseId, depositAmount: 100000, conductedAt: '2026-03-20', dgId: fx.dgId });
  const url = `${baseUrl}/api/leases/${leaseId}/move-out-report`;

  const cur = await (await fetch(url, { headers: auth() })).json();
  const patch = await fetch(url, {
    method: 'PATCH',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zones: cur.report.zones,
      extraLines: [
        { kind: 'main_oeuvre', label: 'Peinture salon', amount: 10000 },
        { kind: 'realisee_locataire', label: 'Remplacement serrure', amount: 0 },
      ],
    }),
  });
  assert.equal(patch.status, 200);
  const { statement, report } = await patch.json();
  assert.equal(report.otherDeductionsAmount, 10000);
  assert.equal(statement.rent.owed, 120000);
  assert.equal(statement.rent.monthsCount, 3);
  assert.equal(statement.shortfall, 30000);
  assert.equal(statement.netRefund, 0);

  const noChoice = await fetch(`${url}/finalize`, { method: 'POST', headers: auth(), body: new FormData() });
  assert.equal(noChoice.status, 400);

  const form = new FormData();
  form.set('balanceResolution', 'repairs_by_tenant');
  const ok = await fetch(`${url}/finalize`, { method: 'POST', headers: auth(), body: form });
  assert.equal(ok.status, 200);
  const fin = (await ok.json()).report;
  assert.equal(fin.balanceDueAmount, 30000);
  assert.equal(fin.balanceResolution, 'repairs_by_tenant');
  assert.equal(fin.rentOwedAmount, 120000);
  assert.equal(fin.netRefund, 0);

  const pdf = await fetch(`${url}.pdf`, { headers: auth() });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /pdf/);
});

test('point de sortie positif : finalisation sans signature numérique', async () => {
  const { leaseId } = await insertActiveLease(fx, { unitCode: 'U-PT-2', depositAmount: 100000, monthlyRent: 40000, startDate: '2026-01-01', renterSuffix: '2' });
  for (const month of ['2026-01', '2026-02', '2026-03']) {
    await pool.query(
      "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at) VALUES (:t, :l, :m, :d, 40000, 'especes', :d)",
      { t: fx.tenantId, l: leaseId, m: month, d: `${month}-01` },
    );
  }
  await insertDraftMoveOutReport({ tenantId: fx.tenantId, leaseId, depositAmount: 100000, conductedAt: '2026-03-20', dgId: fx.dgId });
  const form = new FormData();
  form.set('refundPaymentMethod', 'especes');
  const res = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/finalize`, { method: 'POST', headers: auth(), body: form });
  assert.equal(res.status, 200);
  const { report } = await res.json();
  assert.equal(report.netRefund, 100000);
  assert.equal(report.balanceDueAmount, 0);
});
