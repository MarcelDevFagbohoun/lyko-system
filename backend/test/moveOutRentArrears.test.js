'use strict';

/**
 * Arriérés de loyer réglés par la caution à la sortie (demande utilisateur, 2026-10-18) : un
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

test('finalize sortie — 3 mois de loyer impayés déduits de la caution, enregistrés comme des rent_payments "caution"', async () => {
  const { leaseId } = await insertActiveLease(fx, { unitCode: 'U-ARR-1', depositAmount: 200000, monthlyRent: 40000, startDate: '2026-01-01' });
  await insertDraftMoveOutReport({ tenantId: fx.tenantId, leaseId, depositAmount: 200000, conductedAt: '2026-03-20', dgId: fx.dgId });

  const res = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/finalize`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: fakeSignatureForm({ refundPaymentMethod: 'especes' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  // Bail démarré le 1er janvier (échéance le 5), sortie le 20 mars, aucun paiement jamais reçu :
  // janvier + février + mars dus (mars aussi déjà en retard au 20, après son échéance du 5) = 120 000.
  assert.equal(body.report.rentArrearsAmount, 120000);
  assert.equal(body.report.totalDeductions, 120000);
  assert.equal(body.report.netRefund, 80000);

  const [rows] = await pool.query(
    "SELECT covers_month, amount, payment_method, notes FROM rent_payments WHERE lease_id = :id AND payment_method = 'caution' ORDER BY covers_month",
    { id: leaseId },
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.covers_month), ['2026-01', '2026-02', '2026-03']);
  assert.ok(rows.every((r) => Number(r.amount) === 40000));
  assert.match(rows[0].notes, /caution/);

  const [[lease]] = await pool.query('SELECT status FROM leases WHERE id = :id', { id: leaseId });
  assert.equal(lease.status, 'ended');

  // Garantie centrale de la demande utilisateur : une fois réglé, ce locataire ne doit plus
  // apparaître dans les impayés — le bail étant `ended`, il est exclu de `listPortfolioArrears`.
  const stillArrears = await listPortfolioArrears(fx.tenantId);
  assert.ok(!stillArrears.some((a) => a.leaseId === leaseId));
});

test('finalize sortie — aucun impayé : rentArrearsAmount reste à 0, comportement inchangé', async () => {
  const { leaseId } = await insertActiveLease(fx, { unitCode: 'U-ARR-2', depositAmount: 100000, monthlyRent: 40000, startDate: '2026-01-01', renterSuffix: '2' });
  // Tout payé jusqu'à mars inclus.
  for (const month of ['2026-01', '2026-02', '2026-03']) {
    await pool.query(
      "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at) VALUES (:t, :l, :m, :d, 40000, 'especes', :d)",
      { t: fx.tenantId, l: leaseId, m: month, d: `${month}-01` },
    );
  }
  await insertDraftMoveOutReport({ tenantId: fx.tenantId, leaseId, depositAmount: 100000, conductedAt: '2026-03-20', dgId: fx.dgId });

  const res = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/finalize`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: fakeSignatureForm({ refundPaymentMethod: 'especes' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.report.rentArrearsAmount, 0);
  assert.equal(body.report.totalDeductions, 0);
  assert.equal(body.report.netRefund, 100000);

  const [rows] = await pool.query("SELECT id FROM rent_payments WHERE lease_id = :id AND payment_method = 'caution'", { id: leaseId });
  assert.equal(rows.length, 0);
});

test('finalize sortie — caution insuffisante pour tout couvrir : les dégradations/autres retenues gardent la priorité, les arriérés sont plafonnés au reste', async () => {
  const { leaseId } = await insertActiveLease(fx, { unitCode: 'U-ARR-3', depositAmount: 50000, monthlyRent: 40000, startDate: '2026-01-01', renterSuffix: '3' });
  // 2 mois dus = 80 000 d'arriérés, mais seulement 20 000 de caution restent après 30 000
  // d'« autres retenues » (dégradations hors-grille, simulées ici par other_deductions_amount).
  await insertDraftMoveOutReport({
    tenantId: fx.tenantId,
    leaseId,
    depositAmount: 50000,
    conductedAt: '2026-03-20',
    dgId: fx.dgId,
    otherDeductionsAmount: 30000,
  });

  const res = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/finalize`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: fakeSignatureForm({}), // netRefund = 0 → aucun mode de règlement requis
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.report.rentArrearsAmount, 20000, 'plafonné au reste de la caution après les autres retenues');
  assert.equal(body.report.totalDeductions, 50000);
  assert.equal(body.report.netRefund, 0);

  const [rows] = await pool.query(
    "SELECT covers_month, amount FROM rent_payments WHERE lease_id = :id AND payment_method = 'caution' ORDER BY covers_month",
    { id: leaseId },
  );
  const totalSettled = rows.reduce((s, r) => s + Number(r.amount), 0);
  assert.equal(totalSettled, 20000);
});

test('finalize sortie — comptabilité avancée active : aucune écriture GL automatique pour les arriérés réglés par la caution (régularisation manuelle, comme les dégradations)', async () => {
  const glFx = await createFixture();
  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: glFx.tenantId });
  try {
    const { leaseId } = await insertActiveLease(glFx, { unitCode: 'U-ARR-GL', depositAmount: 100000, monthlyRent: 40000, startDate: '2026-01-01' });
    await insertDraftMoveOutReport({ tenantId: glFx.tenantId, leaseId, depositAmount: 100000, conductedAt: '2026-03-20', dgId: glFx.dgId });

    const res = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/finalize`, {
      method: 'POST',
      headers: bearer(glFx.dgId, glFx.tenantId),
      body: fakeSignatureForm({ refundPaymentMethod: 'especes' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.report.rentArrearsAmount, 100000, 'plafonné à la caution (120 000 dus, 100 000 de caution)');
    assert.match(body.depositAccountingNote, /arriérés de loyer/);

    const [[entryCount]] = await pool.query(
      `SELECT COUNT(*) AS n FROM gl_entries WHERE tenant_id = :t AND source_table = 'move_out_reports' AND source_id = :id`,
      { t: glFx.tenantId, id: (await pool.query('SELECT id FROM move_out_reports WHERE lease_id = :l', { l: leaseId }))[0][0].id },
    );
    assert.equal(Number(entryCount.n), 0, 'aucune écriture automatique — à régulariser manuellement, comme une retenue de dégradation');
  } finally {
    await pool.query('DELETE FROM rent_payments WHERE tenant_id = :t', { t: glFx.tenantId });
    await teardown(glFx.tenantId);
  }
});

test('finalize sortie — une correction (réouverture) ne rejoue jamais le règlement des arriérés une seconde fois', async () => {
  const { leaseId } = await insertActiveLease(fx, { unitCode: 'U-ARR-4', depositAmount: 100000, monthlyRent: 40000, startDate: '2026-01-01', renterSuffix: '4' });
  await insertDraftMoveOutReport({ tenantId: fx.tenantId, leaseId, depositAmount: 100000, conductedAt: '2026-03-20', dgId: fx.dgId });

  const first = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/finalize`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: fakeSignatureForm({ refundPaymentMethod: 'especes' }),
  });
  assert.equal(first.status, 200);

  const reopen = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/reopen`, {
    method: 'POST',
    headers: { ...bearer(fx.dgId, fx.tenantId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Correction de test' }),
  });
  assert.equal(reopen.status, 200);

  const second = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/finalize`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: fakeSignatureForm({ refundPaymentMethod: 'especes' }),
  });
  assert.equal(second.status, 200);
  const body = await second.json();
  assert.equal(body.report.rentArrearsAmount, 100000, 'valeur figée reprise telle quelle, jamais recalculée sur une correction');

  const [rows] = await pool.query("SELECT id FROM rent_payments WHERE lease_id = :id AND payment_method = 'caution'", { id: leaseId });
  assert.equal(rows.length, 3, 'jamais dupliqué par la correction');
});
