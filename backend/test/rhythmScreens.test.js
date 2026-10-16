'use strict';

/**
 * Refonte de la clôture (étapes 2b/2c, 2026-10-16) : les écrans d'une entreprise en rythme
 * « jour fixe »/« libre ». Le moteur (étape 2a, `rentEngineRhythm.test.js`) calculait déjà juste ;
 * ces tests couvrent ce que l'utilisateur VOIT :
 *  - toute réponse qui expose `coversMonth` renvoie une clé exploitable, jamais `null` ;
 *  - la quittance et le contrat de bail libellent une période non-calendaire en dates réelles.
 *
 * Étape 53 (retour à la clôture par mois civil) : le rythme n'est plus modifiable par l'API et la
 * clôture ne fige plus d'archive ni ne remet à zéro les notes — vérifié en fin de fichier.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { periodEndOf, paymentPeriodKey } = require('../src/services/rentTracking');
const { formatPeriodLabel } = require('../src/services/pdf');

// ───────────────────────── Unités pures (aucun accès base) ─────────────────────────

test('periodEndOf — calendaire : dernier jour du mois ; non-calendaire : veille de la période suivante', () => {
  assert.equal(periodEndOf('2026-02'), '2026-02-28');
  assert.equal(periodEndOf('2026-12'), '2026-12-31');
  assert.equal(periodEndOf('2026-10-05'), '2026-11-04');
  assert.equal(periodEndOf('2026-12-15'), '2027-01-14');
});

test('paymentPeriodKey — covers_month pour un bail calendaire, covers_period_start sinon, jamais null', () => {
  assert.equal(paymentPeriodKey({ covers_month: '2026-03', covers_period_start: new Date('2026-03-01T00:00:00Z') }), '2026-03');
  assert.equal(paymentPeriodKey({ covers_month: null, covers_period_start: new Date('2026-03-05T00:00:00Z') }), '2026-03-05');
  assert.equal(paymentPeriodKey({ covers_month: null, covers_period_start: '2026-03-05' }), '2026-03-05');
});

test('formatPeriodLabel — nom du mois en calendaire, plage de dates réelle sinon', () => {
  assert.equal(formatPeriodLabel('2026-10'), 'octobre 2026');
  assert.equal(formatPeriodLabel('2026-10-05'), 'du 05 octobre au 04 novembre 2026');
  // Chevauchement de deux années : l'année figure des deux côtés.
  assert.equal(formatPeriodLabel('2026-12-15'), 'du 15 décembre 2026 au 14 janvier 2027');
});

// ───────────────────────── Intégration (vraies routes, tenant « jour fixe ») ─────────────────────────

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
  'Content-Type': 'application/json',
});

/** Tenant « jour fixe » (jour 5), comptabilité démarrée le 2026-01-05, bail payable 10 jours après le début de période. */
async function createJourFixeFixture() {
  const fx = await createBareFixture();
  await pool.query('UPDATE tenants SET accounting_start_date = :d WHERE id = :t', { d: '2026-01-05', t: fx.tenantId });
  // Le rythme n'est plus modifiable par l'API (étape 53) : réglé en base pour exercer le moteur,
  // qui reste capable de traiter un bail non-calendaire existant.
  await pool.query("UPDATE tenants SET period_rhythm_mode = 'jour_fixe', period_start_day = 5 WHERE id = :t", { t: fx.tenantId });
  await pool.query(
    "UPDATE leases SET rent_due_day = NULL, rent_due_offset_days = 10, start_date = :d, created_at = '2026-01-05 08:00:00' WHERE id = :id",
    { d: '2026-01-05', id: fx.leaseId },
  );
  return fx;
}

async function cleanup(fx) {
  await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
}

test('GET /api/renters/:id et le portail — coversMonth d\'un paiement non-calendaire vaut la date de début de période, jamais null', async () => {
  const fx = await createJourFixeFixture();
  try {
    const payRes = await fetch(`${baseUrl}/api/leases/${fx.leaseId}/payments`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify({ amount: 50000, paymentMethod: 'especes', paidAt: '2026-01-10' }),
    });
    assert.equal(payRes.status, 201, await payRes.text());

    const renterRes = await fetch(`${baseUrl}/api/renters/${fx.renterId}`, { headers: bearer(fx.dgId, fx.tenantId) });
    const renterBody = await renterRes.json();
    assert.equal(renterRes.status, 200, JSON.stringify(renterBody));
    const lease = renterBody.leases.find((l) => l.id === fx.leaseId);
    assert.equal(lease.payments[0].coversMonth, '2026-01-05');
    assert.equal(lease.rentDueDay, null);
    assert.equal(lease.rentDueOffsetDays, 10);

    const linkRes = await fetch(`${baseUrl}/api/renters/${fx.renterId}/portal-link`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
    });
    const { token } = await linkRes.json();
    const portalRes = await fetch(`${baseUrl}/api/portal/${token}`);
    const portalBody = await portalRes.json();
    assert.equal(portalRes.status, 200, JSON.stringify(portalBody));
    assert.equal(portalBody.payments[0].coversMonth, '2026-01-05');
    for (const cell of portalBody.rentStrip) {
      assert.match(cell.month, /^\d{4}-\d{2}-05$/);
    }
  } finally {
    await cleanup(fx);
  }
});

test('GET /api/leases/:id/contract — le contrat d\'un bail non-calendaire expose rentDueOffsetDays', async () => {
  const fx = await createJourFixeFixture();
  try {
    const res = await fetch(`${baseUrl}/api/leases/${fx.leaseId}/contract`, { headers: bearer(fx.dgId, fx.tenantId) });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.preview.lease.rentDueDay, null);
    assert.equal(body.preview.lease.rentDueOffsetDays, 10);
  } finally {
    await cleanup(fx);
  }
});

test('GET /api/accounting/rent-month — un bail non-calendaire est compté pour la période qui commence dans le mois (plus de 500)', async () => {
  const fx = await createJourFixeFixture();
  try {
    const payRes = await fetch(`${baseUrl}/api/leases/${fx.leaseId}/payments`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify({ amount: 30000, paymentMethod: 'especes', paidAt: '2026-01-10' }),
    });
    assert.equal(payRes.status, 201, await payRes.text());

    const res = await fetch(`${baseUrl}/api/accounting/rent-month?month=2026-01`, { headers: bearer(fx.dgId, fx.tenantId) });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    // Période du 2026-01-05 : 50 000 attendus, 30 000 encaissés, échéance (2026-01-15) dépassée.
    assert.equal(body.expected, 50000);
    assert.equal(body.collected, 30000);
    assert.equal(body.remaining, 20000);
    assert.equal(body.lateRemaining, 20000);
    assert.equal(body.counts.partiel, 1);
  } finally {
    await cleanup(fx);
  }
});

test('GET /api/accounting/dashboard — un loyer non-calendaire entre dans le séquestre du mois où commence sa période (plus de 500)', async () => {
  const fx = await createJourFixeFixture();
  try {
    const payRes = await fetch(`${baseUrl}/api/leases/${fx.leaseId}/payments`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify({ amount: 50000, paymentMethod: 'especes', paidAt: '2026-01-10' }),
    });
    assert.equal(payRes.status, 201, await payRes.text());

    const res = await fetch(`${baseUrl}/api/accounting/dashboard?from=2026-01-01&to=2026-01-31`, { headers: bearer(fx.dgId, fx.tenantId) });
    assert.equal(res.status, 200, await res.text());

    // Période du 2026-01-05 → rattachée au mois civil de janvier 2026.
    const { getEscrowBalances, getRecetteNetteMaison } = require('../src/services/commission');
    await getEscrowBalances(fx.tenantId); // ne plante plus sur un mois `null`
    const recette = await getRecetteNetteMaison(fx.tenantId, fx.propertyId, '2026-01');
    assert.equal(recette.totalPayments, 50000);
  } finally {
    await cleanup(fx);
  }
});

test('Étape 53 — le rythme n\'est plus modifiable, la clôture ne remet plus les notes à zéro et n\'archive plus', async () => {
  const fx = await createBareFixture();
  try {
    const patch = await fetch(`${baseUrl}/api/accounting/rhythm`, {
      method: 'PATCH',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify({ mode: 'jour_fixe', startDay: 5 }),
    });
    assert.equal(patch.status, 404);
    const openPeriod = await fetch(`${baseUrl}/api/accounting/open-period`, { headers: bearer(fx.dgId, fx.tenantId) });
    assert.equal(openPeriod.status, 404);

    await pool.query("UPDATE renters SET notes = 'Note à garder' WHERE id = :id", { id: fx.renterId });
    const closeRes = await fetch(`${baseUrl}/api/accounting/periods`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify({ period: '2026-01', force: true }),
    });
    assert.equal(closeRes.status, 201, await closeRes.text());

    const [[renter]] = await pool.query('SELECT notes FROM renters WHERE id = :id', { id: fx.renterId });
    assert.equal(renter.notes, 'Note à garder');
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM monthly_renter_archive WHERE tenant_id = :t', { t: fx.tenantId });
    assert.equal(Number(n), 0);
    const archive = await fetch(`${baseUrl}/api/accounting/periods/2026-01/archive`, { headers: bearer(fx.dgId, fx.tenantId) });
    assert.equal(archive.status, 404);
  } finally {
    await cleanup(fx);
  }
});
