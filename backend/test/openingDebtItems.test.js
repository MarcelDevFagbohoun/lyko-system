'use strict';

/**
 * Détail des impayés à l'entrée par type + mois (demande utilisateur, 2026-11-12) : « donner au
 * niveau des impayés des options comme impayés loyer, impayé factures SBEE, impayé SONEB, impayé
 * frais des poubelles et autres... les mois choisir comme impayés doit être en rouge » (le rouge est
 * un détail d'affichage frontend, ce fichier vérifie uniquement le backend : migration 151,
 * validators, services/leasePayments.js `listOpeningDebtItems`/`payOpeningDebtItem`, routes).
 *
 * Invariant central vérifié ici : `leases.opening_debt_amount` (source de vérité historique, lue par
 * 9 autres fichiers) reste TOUJOURS égal à la somme des postes `lease_opening_debt_items`, et chaque
 * règlement d'un poste crée bien, en plus, la ligne `lease_opening_debt_payments` correspondante
 * (voir `payOpeningDebtItem`) — jamais les deux de façon indépendante.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');

let fx; let server; let base; let unit2Id; let renterId; let leaseId;
const hdr = (userId, role) => ({ Authorization: `Bearer ${signAccessToken({ sub: userId, tenantId: fx.tenantId, role })}` });

// Deux mois dans la fenêtre des 12 derniers mois (jamais le mois en cours, pour éviter toute
// ambiguïté avec un éventuel loyer déjà facturé ce mois-ci par d'autres mécanismes).
function monthsAgo(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const month1 = monthsAgo(2);
const month2 = monthsAgo(1);

before(async () => {
  fx = await createFixture();

  const [unit2] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:tenantId, :propertyId, 'U2', 'studio', 'libre', 50000, :by)",
    { tenantId: fx.tenantId, propertyId: fx.propertyId, by: fx.dgId },
  );
  unit2Id = unit2.insertId;

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await teardown(fx.tenantId);
  await closePool();
});

test('création d\'un locataire avec un détail d\'impayés par type + mois : le total est recalculé côté serveur', async () => {
  const r = await fetch(`${base}/api/renters`, {
    method: 'POST',
    headers: { ...hdr(fx.dgId, 'dg'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Ancien',
      lastName: 'Locataire',
      phone: `07${Math.floor(Math.random() * 100000000)}`,
      unitId: unit2Id,
      monthlyRent: 50000,
      startDate: '2026-01-01',
      // `upToDateAtOnboarding: true` serait contradictoire ici (un poste loyer impayé est déclaré
      // ci-dessous) — rejeté côté serveur depuis l'audit du 2026-11-12, voir
      // `validators/renters.js` `forbidUpToDateWithLoyerOpeningDebt` et
      // `upToDateVsOpeningDebtValidation.test.js`. Simplement omis ici : défaut `false`.
      openingDebtItems: [
        { debtType: 'loyer', periodMonth: month1, amount: 50000 },
        { debtType: 'sbee', periodMonth: month2, label: 'Facture en retard', amount: 15000 },
      ],
    }),
  });
  assert.equal(r.status, 201);
  const body = await r.json();
  renterId = body.renterId;
  leaseId = body.leaseId;

  const [[lease]] = await pool.query('SELECT opening_debt_amount FROM leases WHERE id = :id', { id: leaseId });
  // Jamais un montant envoyé indépendamment : toujours la somme des postes (50000 + 15000).
  assert.equal(Number(lease.opening_debt_amount), 65000);

  const [items] = await pool.query('SELECT debt_type, period_month, amount FROM lease_opening_debt_items WHERE lease_id = :id ORDER BY period_month', { id: leaseId });
  assert.equal(items.length, 2);
});

test('un mois hors des 12 derniers mois est refusé (400)', async () => {
  const r = await fetch(`${base}/api/renters`, {
    method: 'POST',
    headers: { ...hdr(fx.dgId, 'dg'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Autre',
      lastName: 'Locataire',
      phone: `07${Math.floor(Math.random() * 100000000)}`,
      unitId: unit2Id,
      monthlyRent: 50000,
      startDate: '2026-01-01',
      openingDebtItems: [{ debtType: 'loyer', periodMonth: '2020-01', amount: 50000 }],
    }),
  });
  assert.equal(r.status, 400);
});

test('GET /opening-debt/items renvoie le détail avec le solde de chaque poste', async () => {
  const r = await fetch(`${base}/api/leases/${leaseId}/opening-debt/items`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.items.length, 2);
  for (const item of body.items) {
    assert.equal(item.paid, 0);
    assert.equal(item.remaining, item.amount);
    assert.equal(item.status, 'impayee');
  }
});

test('régler partiellement UN poste : son solde baisse, les autres postes et le solde du bail restent cohérents', async () => {
  const before1 = await (await fetch(`${base}/api/leases/${leaseId}/opening-debt/items`, { headers: hdr(fx.dgId, 'dg') })).json();
  const loyerItem = before1.items.find((i) => i.debtType === 'loyer');

  const r = await fetch(`${base}/api/leases/${leaseId}/opening-debt/items/${loyerItem.id}/payments`, {
    method: 'POST',
    headers: { ...hdr(fx.dgId, 'dg'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 20000, paymentMethod: 'especes', paidAt: '2026-11-05' }),
  });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.itemRemaining, 30000);
  assert.equal(body.leaseRemaining, 65000 - 20000);

  // La ligne `lease_opening_debt_payments` (source de vérité historique lue par les 9 autres
  // consommateurs) a bien été créée en plus de la ligne détaillée — jamais l'une sans l'autre.
  const [[payment]] = await pool.query('SELECT amount FROM lease_opening_debt_payments WHERE id = :id', { id: body.paymentId });
  assert.equal(Number(payment.amount), 20000);
  const [[itemPayment]] = await pool.query(
    'SELECT amount FROM lease_opening_debt_item_payments WHERE lease_payment_id = :id',
    { id: body.paymentId },
  );
  assert.equal(Number(itemPayment.amount), 20000);

  const after1 = await (await fetch(`${base}/api/leases/${leaseId}/opening-debt/items`, { headers: hdr(fx.dgId, 'dg') })).json();
  const sbeeItem = after1.items.find((i) => i.debtType === 'sbee');
  // Poste SBEE totalement indépendant, intact.
  assert.equal(sbeeItem.remaining, 15000);
  assert.equal(sbeeItem.status, 'impayee');
  const updatedLoyerItem = after1.items.find((i) => i.debtType === 'loyer');
  assert.equal(updatedLoyerItem.remaining, 30000);
  assert.equal(updatedLoyerItem.status, 'partiellement_payee');
});

test('un montant supérieur au solde restant du poste est refusé (400)', async () => {
  const items = (await (await fetch(`${base}/api/leases/${leaseId}/opening-debt/items`, { headers: hdr(fx.dgId, 'dg') })).json()).items;
  const loyerItem = items.find((i) => i.debtType === 'loyer');
  const r = await fetch(`${base}/api/leases/${leaseId}/opening-debt/items/${loyerItem.id}/payments`, {
    method: 'POST',
    headers: { ...hdr(fx.dgId, 'dg'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 999999, paymentMethod: 'especes', paidAt: '2026-11-05' }),
  });
  assert.equal(r.status, 400);
});

test('solder complètement un poste puis tenter de le régler à nouveau : 409', async () => {
  const items = (await (await fetch(`${base}/api/leases/${leaseId}/opening-debt/items`, { headers: hdr(fx.dgId, 'dg') })).json()).items;
  const loyerItem = items.find((i) => i.debtType === 'loyer');
  const r1 = await fetch(`${base}/api/leases/${leaseId}/opening-debt/items/${loyerItem.id}/payments`, {
    method: 'POST',
    headers: { ...hdr(fx.dgId, 'dg'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: loyerItem.remaining, paymentMethod: 'especes', paidAt: '2026-11-05' }),
  });
  assert.equal(r1.status, 201);
  const body1 = await r1.json();
  assert.equal(body1.itemRemaining, 0);

  const r2 = await fetch(`${base}/api/leases/${leaseId}/opening-debt/items/${loyerItem.id}/payments`, {
    method: 'POST',
    headers: { ...hdr(fx.dgId, 'dg'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 1000, paymentMethod: 'especes', paidAt: '2026-11-05' }),
  });
  assert.equal(r2.status, 409);
});
