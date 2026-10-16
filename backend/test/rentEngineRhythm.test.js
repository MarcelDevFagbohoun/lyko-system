'use strict';

/**
 * Refonte de la clôture (étape 2/5, 2026-10-16) : généralisation du moteur de loyer
 * (`rentTracking.js`) à un rythme de période configurable, pas seulement le mois civil. Ces tests
 * couvrent spécifiquement les chemins NON-calendaire (`jour_fixe`) — le chemin calendaire reste
 * couvert, inchangé, par les 38 tests existants de `test/rentTracking.test.js` (aucun n'a eu besoin
 * d'être modifié par cette étape, preuve que le comportement calendaire est resté byte pour byte
 * identique).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { computeArrears, allocateRentPayment, buildRentStrip } = require('../src/services/rentTracking');

const JOUR_FIXE = { mode: 'jour_fixe', startDay: 5 };

// ───────────────────────── Unités pures (aucun accès base) ─────────────────────────

test('computeArrears — rythme jour_fixe : avance par périodes ancrées sur le jour 5, échéance via rentDueOffsetDays', () => {
  const arrears = computeArrears(
    {
      startDate: '2026-01-05',
      createdAt: '2026-01-05',
      rentDueOffsetDays: 10, // loyer dû 10 jours après le début de la période
      rentTiming: 'avance',
      monthlyRent: 50000,
      payments: [{ coversMonth: '2026-01-05', amount: 50000 }],
      rhythm: JOUR_FIXE,
    },
    new Date('2026-02-10T00:00:00Z'),
  );
  // Janvier (2026-01-05) soldé → la période suivante commence le 2026-02-05, ancrée sur le même jour.
  assert.equal(arrears.nextDueMonth, '2026-02-05');
  assert.equal(arrears.dueDate, '2026-02-15'); // 2026-02-05 + 10 jours
  assert.equal(arrears.status, 'current'); // 2026-02-10 < 2026-02-15, pas encore en retard
});

test('computeArrears — rythme jour_fixe + terme_echu : l\'échéance est décalée à LA PÉRIODE SUIVANTE + offset', () => {
  const arrears = computeArrears(
    {
      startDate: '2026-01-05',
      createdAt: '2026-01-05',
      rentDueOffsetDays: 0,
      rentTiming: 'terme_echu',
      monthlyRent: 50000,
      payments: [],
      rhythm: JOUR_FIXE,
    },
    new Date('2026-01-06T00:00:00Z'),
  );
  // Période de janvier (2026-01-05) due à terme échu : échéance = début de la période SUIVANTE (2026-02-05) + 0 jour.
  assert.equal(arrears.nextDueMonth, '2026-01-05');
  assert.equal(arrears.dueDate, '2026-02-05');
  assert.equal(arrears.status, 'current');
});

test('allocateRentPayment — rythme jour_fixe : répartit sur des périodes successives ancrées sur le même jour', () => {
  const { allocations, fullMonths, partialAmount } = allocateRentPayment({
    rhythm: JOUR_FIXE,
    nextDueMonth: '2026-03-05',
    monthlyRent: 50000,
    amount: 125000, // la 1ère période entière (shortfall) + 1 période pleine (boucle) + 25000 en partiel
  });
  assert.equal(fullMonths, 1); // ne compte que la boucle "mois pleins" — la 1ère période est comptée via le shortfall, pas ici (comportement hérité, inchangé par cette étape)
  assert.equal(partialAmount, 25000);
  assert.deepEqual(
    allocations.map((a) => a.coversMonth),
    ['2026-03-05', '2026-04-05', '2026-05-05'],
  );
  assert.equal(allocations[2].isPartial, true);
});

test('buildRentStrip — rythme jour_fixe : 12 périodes ancrées sur le jour de départ du bail, jamais sur le 1er du mois', () => {
  const strip = buildRentStrip(
    {
      startDate: '2025-06-05',
      createdAt: '2025-06-05',
      rentDueOffsetDays: 5,
      rentTiming: 'avance',
      monthlyRent: 50000,
      payments: [],
      rhythm: JOUR_FIXE,
    },
    new Date('2026-03-10T00:00:00Z'),
  );
  assert.equal(strip.length, 12);
  for (const cell of strip) {
    assert.match(cell.month, /^\d{4}-\d{2}-05$/, `chaque période doit démarrer le jour 05 : ${cell.month}`);
  }
  const current = strip.find((c) => c.isCurrent);
  assert.ok(current, 'une cellule doit être marquée "en cours"');
  // 2026-03-10 tombe dans la période qui démarre le 2026-03-05 (la précédente, 2026-02-05, est déjà finie).
  assert.equal(current.month, '2026-03-05');
});

// ───────────────────────── Intégration (vraies routes, vrai bail non-calendaire) ─────────────────────────

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
  'Content-Type': 'application/json',
});

test(
  'POST /api/renters puis POST .../payments — un bail créé sous un tenant "jour_fixe" reçoit ' +
    'rent_due_offset_days (jamais rent_due_day), et son paiement est écrit avec covers_period_start ' +
    '(jamais covers_month)',
  async () => {
    const fx = await createBareFixture();
    try {
      await fetch(`${baseUrl}/api/accounting/rhythm`, {
        method: 'PATCH',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ mode: 'jour_fixe', startDay: 5 }),
      });

      const [unit] = await pool.query(
        "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'U2', 'studio', 'libre', 50000, :by)",
        { t: fx.tenantId, p: fx.propertyId, by: fx.dgId },
      );
      const freeUnitId = unit.insertId;

      const createRes = await fetch(`${baseUrl}/api/renters`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({
          firstName: 'Jour',
          lastName: 'Fixe',
          phone: `01${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
          unitId: freeUnitId,
          depositAmount: 0,
          rentDueOffsetDays: 10,
          startDate: '2026-01-05',
        }),
      });
      const createBody = await createRes.json();
      assert.equal(createRes.status, 201, JSON.stringify(createBody));
      const { leaseId } = createBody;

      const [[leaseRow]] = await pool.query('SELECT rent_due_day, rent_due_offset_days FROM leases WHERE id = :id', {
        id: leaseId,
      });
      assert.equal(leaseRow.rent_due_day, null);
      assert.equal(leaseRow.rent_due_offset_days, 10);

      // `baselineMonthOf` plafonne le suivi à `created_at` (le bail vient d'être créé "aujourd'hui"
      // par cet appel API) — reculé manuellement ici pour que le suivi démarre bien à `startDate`,
      // même principe déjà établi ailleurs dans cette suite (voir monthClosingAudit.test.js).
      await pool.query("UPDATE leases SET created_at = '2026-01-05 08:00:00' WHERE id = :id", { id: leaseId });

      const payRes = await fetch(`${baseUrl}/api/leases/${leaseId}/payments`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ amount: 50000, paymentMethod: 'especes', paidAt: '2026-01-10' }),
      });
      const payBody = await payRes.json();
      assert.equal(payRes.status, 201, JSON.stringify(payBody));

      const [[paymentRow]] = await pool.query(
        'SELECT covers_month, covers_period_start, amount FROM rent_payments WHERE lease_id = :id',
        { id: leaseId },
      );
      assert.equal(paymentRow.covers_month, null);
      assert.equal(
        paymentRow.covers_period_start instanceof Date
          ? paymentRow.covers_period_start.toISOString().slice(0, 10)
          : paymentRow.covers_period_start,
        '2026-01-05',
      );
      assert.equal(Number(paymentRow.amount), 50000);
    } finally {
      await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t', { t: fx.tenantId });
      await teardown(fx.tenantId);
    }
  },
);

test(
  'POST /api/accounting/periods — clôturer une période "jour_fixe" fige désormais aussi ' +
    'lease_balance_snapshots ET monthly_renter_archive (plus seulement calendaire)',
  async () => {
    const fx = await createBareFixture();
    try {
      await pool.query('UPDATE tenants SET accounting_start_date = :d WHERE id = :t', { d: '2026-01-05', t: fx.tenantId });
      await fetch(`${baseUrl}/api/accounting/rhythm`, {
        method: 'PATCH',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ mode: 'jour_fixe', startDay: 5 }),
      });
      await pool.query(
        'UPDATE leases SET rent_due_day = NULL, rent_due_offset_days = 10, start_date = :d WHERE id = :id',
        { d: '2026-01-05', id: fx.leaseId },
      );

      const closeRes = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ force: true }),
      });
      const body = await closeRes.json();
      assert.equal(closeRes.status, 201, JSON.stringify(body));
      assert.equal(body.periodStart, '2026-01-05');
      assert.equal(body.period, null);

      const [[snapshot]] = await pool.query(
        'SELECT period, period_start, period_end FROM lease_balance_snapshots WHERE tenant_id = :t AND lease_id = :l',
        { t: fx.tenantId, l: fx.leaseId },
      );
      assert.ok(snapshot, 'lease_balance_snapshots doit désormais être figé même en rythme jour_fixe');
      assert.equal(snapshot.period, null);
      assert.equal(snapshot.period_start.toISOString().slice(0, 10), '2026-01-05');

      const [[archive]] = await pool.query(
        'SELECT period, period_start, period_end FROM monthly_renter_archive WHERE tenant_id = :t AND lease_id = :l',
        { t: fx.tenantId, l: fx.leaseId },
      );
      assert.ok(archive, 'monthly_renter_archive doit désormais être figée même en rythme jour_fixe');
      assert.equal(archive.period, null);
      assert.equal(archive.period_start.toISOString().slice(0, 10), '2026-01-05');
    } finally {
      await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t', { t: fx.tenantId });
      await teardown(fx.tenantId);
    }
  },
);

after(async () => {
  await closePool();
});
