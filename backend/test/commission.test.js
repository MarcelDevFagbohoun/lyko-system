'use strict';

/**
 * Comptes séquestres par mandat (comptabilité SIMPLE, pas le module
 * SYSCOHADA) — `getEscrowBalances` : combien le cabinet détient
 * actuellement pour chaque propriétaire (recette nette cumulée moins
 * versements déjà effectués). Réutilise les fixtures GL uniquement pour
 * leur commodité de création de tenant/propriétaire/bien/bail jetables —
 * aucune de ces assertions ne dépend du module comptabilité avancée.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { getEscrowBalances, getUnpaidOpeningDebtByOwner, getOwnersWithoutCommissionRate } = require('../src/services/commission');
const { createBareFixture, setCommissionRate } = require('./gl/fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10); // 10 %
});

after(async () => {
  const p = { tenantId: fx.tenantId };
  await pool.query('DELETE FROM rent_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM receipts WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM expenses WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owner_payouts WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owner_commission_rates WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM leases WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM renters WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM property_units WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM properties WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owners WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM users WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM tenants WHERE id = :tenantId', p);
  await closePool();
});

test('getEscrowBalances — recette nette cumulée (commission 10%) moins versements déjà effectués', async () => {
  // Deux mois de loyer encaissé (100 000 chacun), un mois avec une dépense
  // du Bien de 5 000 (déduite AVANT commission, comme getRecetteNetteMaison).
  await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-01', 100000, 'virement', '2026-01-05', :by), (:t, :l, '2026-02', 100000, 'virement', '2026-02-05', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO expenses (tenant_id, property_id, category, label, amount, expense_date, payment_method, recorded_by)
     VALUES (:t, :p, 'entretien', 'Réparation', 5000, '2026-01-15', 'especes', :by)`,
    { t: fx.tenantId, p: fx.propertyId, by: fx.dgId },
  );

  const balances = await getEscrowBalances(fx.tenantId);
  const b = balances.get(fx.ownerId);
  assert.ok(b, 'le propriétaire doit apparaître');

  // Janvier : (100000 - 5000) * 90% = 85500. Février : 100000 * 90% = 90000.
  assert.equal(b.totalCollected, 85500 + 90000);
  assert.equal(b.totalPayouts, 0);
  assert.equal(b.balance, 85500 + 90000);

  // Un versement partiel réduit le solde détenu, jamais la recette cumulée.
  await pool.query(
    `INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, recorded_by)
     VALUES (:t, :o, 100000, 'Acompte', '2026-02-10', 'virement', :by)`,
    { t: fx.tenantId, o: fx.ownerId, by: fx.dgId },
  );
  const after1 = await getEscrowBalances(fx.tenantId);
  const b2 = after1.get(fx.ownerId);
  assert.equal(b2.totalCollected, 175500, 'inchangée par le versement');
  assert.equal(b2.totalPayouts, 100000);
  assert.equal(b2.balance, 75500);
});

test('getEscrowBalances — un versement sans aucune recette donne un solde négatif, sans planter', async () => {
  const [otherOwner] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Propriétaire Sans Recette',
    by: fx.dgId,
  });
  await pool.query(
    `INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, recorded_by)
     VALUES (:t, :o, 20000, 'Avance', '2026-03-01', 'especes', :by)`,
    { t: fx.tenantId, o: otherOwner.insertId, by: fx.dgId },
  );

  const balances = await getEscrowBalances(fx.tenantId);
  const b = balances.get(otherOwner.insertId);
  assert.ok(b);
  assert.equal(b.totalCollected, 0);
  assert.equal(b.totalPayouts, 20000);
  assert.equal(b.balance, -20000);

  await pool.query('DELETE FROM owner_payouts WHERE owner_id = :o', { o: otherOwner.insertId });
  await pool.query('DELETE FROM owners WHERE id = :o', { o: otherOwner.insertId });
});

test('getUnpaidOpeningDebtByOwner — montant brut restant, jamais mélangé au solde séquestre réel', async () => {
  await pool.query('UPDATE leases SET opening_debt_amount = 30000 WHERE id = :id', { id: fx.leaseId });

  let byOwner = await getUnpaidOpeningDebtByOwner(fx.tenantId);
  assert.equal(byOwner.get(fx.ownerId), 30000, 'rien réglé encore : montant brut intégral');

  await pool.query(
    `INSERT INTO lease_opening_debt_payments (tenant_id, lease_id, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, 20000, 'especes', '2026-03-05', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  byOwner = await getUnpaidOpeningDebtByOwner(fx.tenantId);
  assert.equal(byOwner.get(fx.ownerId), 10000, '30000 déclarés - 20000 réglés, jamais net de commission');

  await pool.query(
    `INSERT INTO lease_opening_debt_payments (tenant_id, lease_id, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, 10000, 'especes', '2026-03-06', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  byOwner = await getUnpaidOpeningDebtByOwner(fx.tenantId);
  assert.equal(byOwner.has(fx.ownerId), false, 'entièrement réglé : plus aucune entrée pour ce propriétaire');

  await pool.query('DELETE FROM lease_opening_debt_payments WHERE lease_id = :l', { l: fx.leaseId });
  await pool.query('UPDATE leases SET opening_debt_amount = 0 WHERE id = :id', { id: fx.leaseId });
});

test('getOwnersWithoutCommissionRate — signale un propriétaire avec des loyers encaissés mais aucun taux jamais défini', async () => {
  // Cas réel trouvé le 22/09/2026 (AKOAKOU Jean, KIko Store) : un propriétaire
  // sans AUCUNE ligne dans owner_commission_rates dont un Bien a pourtant
  // déjà reçu des paiements de loyer — jamais celui de la fixture (qui a un
  // taux depuis before()), un second propriétaire dédié.
  const [owner] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Propriétaire Sans Taux',
    by: fx.dgId,
  });
  const ownerId = owner.insertId;
  const [property] = await pool.query(
    'INSERT INTO properties (tenant_id, code, owner_id, created_by) VALUES (:t, :code, :o, :by)',
    { t: fx.tenantId, code: 'SANS-TAUX-001', o: ownerId, by: fx.dgId },
  );
  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'SANS-TAUX-U1', 'studio', 'loue', 45000, :by)",
    { t: fx.tenantId, p: property.insertId, by: fx.dgId },
  );
  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Sans', 'Taux', :phone, :by)",
    { t: fx.tenantId, phone: `07${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [lease] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-04-01', 45000, 5, 0, 'active', :by)",
    { t: fx.tenantId, r: renter.insertId, u: unit.insertId, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-04', 45000, 'especes', '2026-04-05', :by)`,
    { t: fx.tenantId, l: lease.insertId, by: fx.dgId },
  );

  const flagged = await getOwnersWithoutCommissionRate(fx.tenantId);
  const entry = flagged.find((o) => o.ownerId === ownerId);
  assert.ok(entry, 'doit être signalé : loyers encaissés, aucun taux jamais défini');
  assert.equal(entry.totalCollected, 45000);
  assert.equal(entry.ownerName, 'Propriétaire Sans Taux');

  // Le propriétaire de la fixture (taux 10% défini dans before()) ne doit
  // JAMAIS apparaître dans cette liste.
  assert.equal(flagged.some((o) => o.ownerId === fx.ownerId), false);

  await pool.query('DELETE FROM rent_payments WHERE lease_id = :l', { l: lease.insertId });
  await pool.query('DELETE FROM leases WHERE id = :l', { l: lease.insertId });
  await pool.query('DELETE FROM renters WHERE id = :r', { r: renter.insertId });
  await pool.query('DELETE FROM property_units WHERE id = :u', { u: unit.insertId });
  await pool.query('DELETE FROM properties WHERE id = :p', { p: property.insertId });
  await pool.query('DELETE FROM owners WHERE id = :o', { o: ownerId });
});
