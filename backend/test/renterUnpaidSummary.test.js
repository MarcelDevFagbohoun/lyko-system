'use strict';

/**
 * Fiche locataire : « calculer les impayés charge et loyer et l'afficher sur la page du locataire »
 * (demande utilisateur, 2026-11-10). Vérifie que GET /api/renters/:id renvoie, pour le bail actif :
 * - `rentOwed` : montant réel en FCFA de loyer en retard (même calcul que le Centre de relance/PV de
 *   sortie, `computeRentOwed`) — jusqu'ici seul le statut « en retard » était exposé, jamais un montant.
 * - `unpaidCharges` : charges SONEB/SBEE non soldées de CE bail (une charge `payee` ou d'un AUTRE bail
 *   ne doit jamais s'y mêler).
 * - `unpaidSummary` : total agrégé (loyer en retard + dette initiale non soldée + charges), `null` sans
 *   bail actif.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx; let server; let baseUrl;
before(async () => {
  // Bail actif, démarré 2026-01-01, loyer 50 000, jour d'échéance 5, AUCUN paiement enregistré :
  // à la date du jour (bien après janvier 2026), plusieurs mois sont nécessairement en retard — le test
  // ne fixe jamais ce nombre exact (dépendant de la date du jour), seulement qu'il y a bien un montant dû.
  fx = await createBareFixture();

  // Une charge SONEB déjà soldée (`payee`) : ne doit JAMAIS compter dans les impayés.
  await pool.query(
    `INSERT INTO utility_charges
       (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by)
     VALUES (:t, :l, 'soneb', '2026-08-01', '2026-08-31', 0, 10, 500, 5000, '2026-08-05', 'payee', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  // Une charge SBEE impayée : doit compter en entier (8000).
  await pool.query(
    `INSERT INTO utility_charges
       (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by)
     VALUES (:t, :l, 'sbee', '2026-09-01', '2026-09-30', 0, 20, 400, 8000, '2026-09-05', 'impayee', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  // Une charge SONEB partiellement payée (12000 facturés, 5000 réglés → 7000 restants).
  const [partial] = await pool.query(
    `INSERT INTO utility_charges
       (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by)
     VALUES (:t, :l, 'soneb', '2026-10-01', '2026-10-31', 10, 40, 400, 12000, '2026-10-05', 'partiellement_payee', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :c, 5000, 'especes', '2026-10-10', :by)`,
    { t: fx.tenantId, c: partial.insertId, by: fx.dgId },
  );

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}` });

test('GET /api/renters/:id — loyer en retard chiffré + charges impayées du bail actif + total agrégé', async () => {
  const res = await fetch(`${baseUrl}/api/renters/${fx.renterId}`, { headers: bearer() });
  assert.equal(res.status, 200);
  const body = await res.json();
  const lease = body.leases.find((l) => l.id === fx.leaseId);

  // Loyer en retard : jamais négatif, multiple entier du loyer mensuel (aucun paiement enregistré),
  // forcément > 0 puisque le bail a démarré en janvier 2026 sans le moindre règlement.
  assert.ok(lease.rentOwed > 0);
  assert.equal(lease.rentOwed % 50000, 0);
  assert.equal(lease.arrears.status, 'late');

  // Charges : la payée (5000) est exclue, l'impayée (8000) compte en entier, la partielle ne compte
  // que son reliquat (12000 - 5000 = 7000) → total 15000 sur 2 factures non soldées.
  assert.equal(lease.unpaidCharges.unpaidCount, 2);
  assert.equal(lease.unpaidCharges.totalDue, 15000);

  // Total agrégé = loyer en retard + dette initiale (0, non déclarée à l'ouverture) + charges (15000).
  assert.ok(body.unpaidSummary);
  assert.equal(body.unpaidSummary.chargesTotal, 15000);
  assert.equal(body.unpaidSummary.openingDebtRemaining, 0);
  assert.equal(body.unpaidSummary.rentOwed, lease.rentOwed);
  assert.equal(body.unpaidSummary.total, lease.rentOwed + 15000);
});

test('GET /api/renters/:id — une charge réglée d\'un AUTRE bail n\'entre jamais dans ce total', async () => {
  // Second locataire/bail du même tenant avec une grosse charge impayée : ne doit jamais fuiter dans
  // les impayés du premier locataire.
  const [renter2] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Autre', 'Locataire', :phone, :by)",
    { t: fx.tenantId, phone: `04${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [unit2] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'U2', 'studio', 'loue', 50000, :by)",
    { t: fx.tenantId, p: fx.propertyId, by: fx.dgId },
  );
  const [lease2] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-01-01', 50000, 5, 50000, 'active', :by)",
    { t: fx.tenantId, r: renter2.insertId, u: unit2.insertId, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO utility_charges
       (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by)
     VALUES (:t, :l, 'soneb', '2026-09-01', '2026-09-30', 0, 10, 9999, 99990, '2026-09-05', 'impayee', :by)`,
    { t: fx.tenantId, l: lease2.insertId, by: fx.dgId },
  );

  const res = await fetch(`${baseUrl}/api/renters/${fx.renterId}`, { headers: bearer() });
  const body = await res.json();
  assert.equal(body.unpaidSummary.chargesTotal, 15000); // inchangé, pas 114990
});
