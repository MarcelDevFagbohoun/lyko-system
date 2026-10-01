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
const {
  getEscrowBalances,
  getUnpaidOpeningDebtByOwner,
  getOwnersWithoutCommissionRate,
  getRecetteNetteMaison,
  getRecetteProprietaire,
  getCabinetRevenue,
  pickRateValidAt,
  assertPayoutWithinBalance,
} = require('../src/services/commission');
const { ApiError } = require('../src/middleware/error');
const { createBareFixture, setCommissionRate, teardown } = require('./gl/fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10); // 10 %
});

after(async () => {
  const p = { tenantId: fx.tenantId };
  await pool.query('DELETE FROM lease_opening_debt_payments WHERE tenant_id = :tenantId', p);
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
    `INSERT INTO expenses (tenant_id, property_id, category, label, amount, expense_date, payment_method, paid_at, recorded_by)
     VALUES (:t, :p, 'entretien', 'Réparation', 5000, '2026-01-15', 'especes', '2026-01-15', :by)`,
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

test("pickRateValidAt — un taux futur programmé (sans endsOn) n'est jamais pris pour actif avant sa date de début", () => {
  // Cas réel GBAGUIDI Rodrigue (KIko Store, 23/09/2026) : 10% du 01/07 au
  // 30/09, puis 15% à partir du 01/10 (sans endsOn, car le plus récent).
  const rates = [
    { rate: 15, startsOn: '2026-10-01', endsOn: null },
    { rate: 10, startsOn: '2026-07-01', endsOn: '2026-09-30' },
  ];
  assert.equal(pickRateValidAt(rates, '2026-09-23')?.rate, 10, "aujourd'hui (avant le 01/10) : encore l'ancien taux");
  assert.equal(pickRateValidAt(rates, '2026-09-30')?.rate, 10, 'dernier jour couvert par endsOn : encore inclus');
  assert.equal(pickRateValidAt(rates, '2026-10-01')?.rate, 15, 'à partir de sa date de début : le nouveau taux');
  assert.equal(pickRateValidAt(rates, '2026-06-30'), null, "avant le premier taux jamais défini : aucun");
});

test('pickRateValidAt — un taux sans endsOn déjà commencé reste actif indéfiniment', () => {
  const rates = [{ rate: 10, startsOn: '2026-09-16', endsOn: null }];
  assert.equal(pickRateValidAt(rates, '2026-09-16')?.rate, 10);
  assert.equal(pickRateValidAt(rates, '2027-01-01')?.rate, 10);
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
  await pool.query(
    "INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on) VALUES (:t, :p, :o, '2020-01-01')",
    { t: fx.tenantId, p: property.insertId, o: ownerId },
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

test('assertPayoutWithinBalance — rejette un reversement qui dépasse le solde séquestre réel (audit comptable, anomalie A2)', async () => {
  // Cas réel reproduit lors de l'audit du 23/09/2026 : un reversement de
  // 5 000 000 FCFA avait été accepté sans erreur pour un propriétaire dont
  // le solde réel était nul, rendant son solde séquestre négatif en silence.
  const [owner] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Propriétaire Test A2',
    by: fx.dgId,
  });
  const ownerId = owner.insertId;
  const [property] = await pool.query(
    'INSERT INTO properties (tenant_id, code, owner_id, created_by) VALUES (:t, :code, :o, :by)',
    { t: fx.tenantId, code: 'A2-001', o: ownerId, by: fx.dgId },
  );
  await pool.query(
    "INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on) VALUES (:t, :p, :o, '2020-01-01')",
    { t: fx.tenantId, p: property.insertId, o: ownerId },
  );
  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'A2-U1', 'studio', 'loue', 50000, :by)",
    { t: fx.tenantId, p: property.insertId, by: fx.dgId },
  );
  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'A2', 'Test', :phone, :by)",
    { t: fx.tenantId, phone: `08${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [lease] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-05-01', 50000, 5, 0, 'active', :by)",
    { t: fx.tenantId, r: renter.insertId, u: unit.insertId, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-05', 50000, 'especes', '2026-05-05', :by)`,
    { t: fx.tenantId, l: lease.insertId, by: fx.dgId },
  );
  // Solde réel détenu pour ce propriétaire : 50000 (aucun taux -> 0% de commission, aucun versement déjà fait).

  await assertPayoutWithinBalance(fx.tenantId, ownerId, 50000); // exactement le solde : accepté, ne doit jamais lever.
  await assert.rejects(
    () => assertPayoutWithinBalance(fx.tenantId, ownerId, 50001),
    (err) => err instanceof ApiError && err.status === 400,
    'un seul FCFA de plus que le solde réel doit être rejeté (400)',
  );
  await assert.rejects(
    () => assertPayoutWithinBalance(fx.tenantId, ownerId, 5000000),
    (err) => err instanceof ApiError && err.status === 400,
    'le cas réel de l\'audit (5 000 000 FCFA pour un solde de 50000) doit être rejeté',
  );

  await pool.query('DELETE FROM rent_payments WHERE lease_id = :l', { l: lease.insertId });
  await pool.query('DELETE FROM leases WHERE id = :l', { l: lease.insertId });
  await pool.query('DELETE FROM renters WHERE id = :r', { r: renter.insertId });
  await pool.query('DELETE FROM property_units WHERE id = :u', { u: unit.insertId });
  await pool.query('DELETE FROM properties WHERE id = :p', { p: property.insertId });
  await pool.query('DELETE FROM owners WHERE id = :o', { o: ownerId });
});


test('assertPayoutWithinBalance — verrou + vérification DANS la transaction : trois versements simultanés de 30 000 sur un solde de 50 000, un seul passe', async () => {
  // Avant : le solde était lu HORS transaction ; deux versements simultanés, chacun inférieur au solde,
  // passaient ensemble la vérification et le dépassaient (solde séquestre négatif).
  const [owner] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Propriétaire Test Concurrence',
    by: fx.dgId,
  });
  const ownerId = owner.insertId;
  const [property] = await pool.query(
    'INSERT INTO properties (tenant_id, code, owner_id, created_by) VALUES (:t, :code, :o, :by)',
    { t: fx.tenantId, code: 'CONC-001', o: ownerId, by: fx.dgId },
  );
  await pool.query(
    "INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on) VALUES (:t, :p, :o, '2020-01-01')",
    { t: fx.tenantId, p: property.insertId, o: ownerId },
  );
  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'CONC-U1', 'studio', 'loue', 50000, :by)",
    { t: fx.tenantId, p: property.insertId, by: fx.dgId },
  );
  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Conc', 'Test', :phone, :by)",
    { t: fx.tenantId, phone: `09${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [lease] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-05-01', 50000, 5, 0, 'active', :by)",
    { t: fx.tenantId, r: renter.insertId, u: unit.insertId, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-05', 50000, 'especes', '2026-05-05', :by)`,
    { t: fx.tenantId, l: lease.insertId, by: fx.dgId },
  ); // solde réel détenu : 50 000 (aucun taux → 0 % de commission)

  // Reproduit la séquence de la route : transaction → verrou de la fiche → vérification sur LA connexion → insertion.
  async function attempt(amount) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :t FOR UPDATE', { id: ownerId, t: fx.tenantId });
      await assertPayoutWithinBalance(fx.tenantId, ownerId, amount, conn);
      await conn.query(
        `INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, recorded_by)
         VALUES (:t, :o, :amount, 'Concurrence', '2026-05-20', 'virement', :by)`,
        { t: fx.tenantId, o: ownerId, amount, by: fx.dgId },
      );
      await conn.commit();
      return 'ok';
    } catch (err) {
      await conn.rollback().catch(() => {});
      return err instanceof ApiError ? err.status : `erreur : ${err.message}`;
    } finally {
      conn.release();
    }
  }

  const results = await Promise.all([attempt(30000), attempt(30000), attempt(30000)]);
  assert.equal(results.filter((r) => r === 'ok').length, 1, `un seul versement doit passer, obtenu ${JSON.stringify(results)}`);
  assert.equal(results.filter((r) => r === 400).length, 2, 'les deux autres sont refusés (400)');

  const balances = await getEscrowBalances(fx.tenantId);
  const b = balances.get(ownerId);
  assert.equal(b.totalPayouts, 30000);
  assert.equal(b.balance, 20000, 'le solde n\'est jamais négatif');

  await pool.query('DELETE FROM owner_payouts WHERE owner_id = :o', { o: ownerId });
  await pool.query('DELETE FROM rent_payments WHERE lease_id = :l', { l: lease.insertId });
  await pool.query('DELETE FROM leases WHERE id = :l', { l: lease.insertId });
  await pool.query('DELETE FROM renters WHERE id = :r', { r: renter.insertId });
  await pool.query('DELETE FROM property_units WHERE id = :u', { u: unit.insertId });
  await pool.query('DELETE FROM properties WHERE id = :p', { p: property.insertId });
  await pool.query('DELETE FROM owners WHERE id = :o', { o: ownerId });
});

// ───────────────────────────── prorata d'entrée + dette initiale réglée (étape 42) ─────────────────────────────

test("getEscrowBalances — la dette initiale réglée ET le prorata d'entrée comptent désormais dans le solde séquestre, même traitement qu'un loyer (commission déduite), détail exposé", async () => {
  const before = await getEscrowBalances(fx.tenantId);
  const baseline = before.get(fx.ownerId)?.balance ?? 0;

  // Dette initiale réglée en mars : 40 000 FCFA. Jusqu'ici (avant l'étape 42), seul le RESTE dû
  // apparaissait quelque part (`getUnpaidOpeningDebtByOwner`) — la part réglée n'entrait dans AUCUN
  // total « argent détenu pour ce propriétaire ».
  await pool.query(
    `INSERT INTO lease_opening_debt_payments (tenant_id, lease_id, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, 40000, 'especes', '2026-03-10', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  // Prorata d'entrée réglé le même mois : 15 000 FCFA (simule ce que la route de création de bail écrit).
  await pool.query(
    `UPDATE leases SET entry_proration = 'prorata', entry_prorata_amount = 15000, entry_prorata_days = 9,
            entry_prorata_due_date = '2026-03-05', entry_prorata_received_at = '2026-03-10',
            entry_prorata_received_method = 'especes'
     WHERE id = :l`,
    { l: fx.leaseId },
  );

  const balances = await getEscrowBalances(fx.tenantId);
  const b = balances.get(fx.ownerId);
  // (40 000 + 15 000) × 90 % (commission 10 %) = 49 500 de plus que le solde d'avant.
  assert.equal(b.balance, baseline + 49500);
  assert.equal(b.breakdown.openingDebt, 40000);
  assert.equal(b.breakdown.prorata, 15000);
});

test("getEscrowBalances — un bail sans rien de réglé (prorata='aucun') n'ajoute strictement rien", async () => {
  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Sans', 'Prorata', :phone, :by)",
    { t: fx.tenantId, phone: `09${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [lease] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by, entry_proration, entry_prorata_amount, entry_prorata_days) VALUES (:t, :r, :u, '2026-09-25', 60000, 5, 0, 'active', :by, 'aucun', 0, 10)",
    { t: fx.tenantId, r: renter.insertId, u: fx.unitId, by: fx.dgId },
  );
  const before = await getEscrowBalances(fx.tenantId);
  const after = await getEscrowBalances(fx.tenantId); // aucune écriture entre les deux lectures
  assert.deepEqual(after.get(fx.ownerId), before.get(fx.ownerId));
  await pool.query('DELETE FROM leases WHERE id = :id', { id: lease.insertId });
  await pool.query('DELETE FROM renters WHERE id = :id', { id: renter.insertId });
});

test("getRecetteNetteMaison / getRecetteProprietaire — même mois, même détail (dette initiale + prorata inclus, commission appliquée)", async () => {
  const r = await getRecetteNetteMaison(fx.tenantId, fx.propertyId, '2026-03');
  assert.equal(r.breakdown.openingDebt, 40000);
  assert.equal(r.breakdown.prorata, 15000);
  assert.equal(r.totalPayments, 55000);
  assert.equal(r.recetteNette, 55000);

  const rp = await getRecetteProprietaire(fx.tenantId, fx.propertyId, '2026-03');
  assert.equal(rp.commissionCabinet, 5500); // 10 % de 55 000
  assert.equal(rp.partProprietaire, 49500);
  assert.deepEqual(rp.breakdown, r.breakdown);
});

// ───────────────────────────── recette nette du cabinet (étape 44) ─────────────────────────────

test("getCabinetRevenue — commission sommée sur TOUS les propriétaires + frais d'agence − dépenses de fonctionnement (jamais celles d'un Bien, déjà déduites côté propriétaire)", async () => {
  // Propriétaire A = celui de la fixture (10 %) : loyer 100 000, une dépense DE CE BIEN de 10 000
  // (déduite de SA recette nette avant commission — ne doit JAMAIS apparaître dans les dépenses du
  // cabinet ci-dessous, sinon le même travaux serait compté deux fois).
  await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-06', 100000, 'especes', '2026-06-05', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  const [propertyExpense] = await pool.query(
    `INSERT INTO expenses (tenant_id, property_id, category, label, amount, expense_date, payment_method, paid_at, recorded_by)
     VALUES (:t, :p, 'entretien', 'Réparation Bien A', 10000, '2026-06-10', 'especes', '2026-06-10', :by)`,
    { t: fx.tenantId, p: fx.propertyId, by: fx.dgId },
  );
  // Frais d'agence à l'entrée sur ce même bail, reçus le même mois : 100 % cabinet.
  await pool.query(
    `UPDATE leases SET entry_fee_amount = 20000, entry_fee_received_at = '2026-06-15', entry_fee_received_method = 'especes'
     WHERE id = :l`,
    { l: fx.leaseId },
  );

  // Propriétaire B, taux 20 %, un Bien distinct : loyer 50 000, aucune dépense.
  const [ownerB] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId, n: 'Propriétaire B (recette cabinet)', by: fx.dgId,
  });
  const [propertyB] = await pool.query(
    'INSERT INTO properties (tenant_id, code, owner_id, created_by) VALUES (:t, :code, :o, :by)',
    { t: fx.tenantId, code: 'CAB-B-001', o: ownerB.insertId, by: fx.dgId },
  );
  await pool.query(
    "INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on) VALUES (:t, :p, :o, '2020-01-01')",
    { t: fx.tenantId, p: propertyB.insertId, o: ownerB.insertId },
  );
  const [unitB] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'CAB-B-U1', 'studio', 'loue', 50000, :by)",
    { t: fx.tenantId, p: propertyB.insertId, by: fx.dgId },
  );
  const [renterB] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Cabinet', 'Test B', :phone, :by)",
    { t: fx.tenantId, phone: `06${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [leaseB] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-06-01', 50000, 5, 0, 'active', :by)",
    { t: fx.tenantId, r: renterB.insertId, u: unitB.insertId, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, set_by) VALUES (:t, :o, 20, '2026-01-01', :by)`,
    { t: fx.tenantId, o: ownerB.insertId, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-06', 50000, 'especes', '2026-06-05', :by)`,
    { t: fx.tenantId, l: leaseB.insertId, by: fx.dgId },
  );

  // Dépense de FONCTIONNEMENT du cabinet (property_id NULL) le même mois : 15 000.
  const [cabinetExpense] = await pool.query(
    `INSERT INTO expenses (tenant_id, property_id, category, label, amount, expense_date, payment_method, paid_at, recorded_by)
     VALUES (:t, NULL, 'loyer_bureau', 'Loyer du bureau', 15000, '2026-06-20', 'virement', '2026-06-20', :by)`,
    { t: fx.tenantId, by: fx.dgId },
  );

  const rev = await getCabinetRevenue(fx.tenantId, '2026-06');
  // A : (100000 - 10000) × 10 % = 9000. B : 50000 × 20 % = 10000. Total = 19000.
  assert.equal(rev.breakdown.commission, 19000, 'commission sommée sur les deux propriétaires, jamais une boucle qui en oublierait un');
  assert.equal(rev.breakdown.entryFees, 20000);
  assert.equal(rev.breakdown.expenses, 15000, 'seule la dépense de fonctionnement (property_id NULL), jamais celle du Bien A (déjà déduite côté propriétaire)');
  assert.equal(rev.netCabinetIncome, 19000 + 20000 - 15000);
  assert.equal(rev.yearMonth, '2026-06');

  // Nettoyage propre à ce test (fx est réutilisé par les tests suivants).
  await pool.query('DELETE FROM rent_payments WHERE lease_id IN (:l1, :l2)', { l1: fx.leaseId, l2: leaseB.insertId });
  await pool.query('DELETE FROM expenses WHERE id IN (:e1, :e2)', { e1: propertyExpense.insertId, e2: cabinetExpense.insertId });
  await pool.query("UPDATE leases SET entry_fee_amount = 0, entry_fee_received_at = NULL, entry_fee_received_method = NULL WHERE id = :l", { l: fx.leaseId });
  await pool.query('DELETE FROM leases WHERE id = :l', { l: leaseB.insertId });
  await pool.query('DELETE FROM renters WHERE id = :r', { r: renterB.insertId });
  await pool.query('DELETE FROM property_units WHERE id = :u', { u: unitB.insertId });
  await pool.query('DELETE FROM owner_commission_rates WHERE owner_id = :o', { o: ownerB.insertId });
  await pool.query('DELETE FROM properties WHERE id = :p', { p: propertyB.insertId });
  await pool.query('DELETE FROM owners WHERE id = :o', { o: ownerB.insertId });
});

test("getCabinetRevenue — aucune donnée sur le mois : tout à zéro, jamais une erreur", async () => {
  const rev = await getCabinetRevenue(fx.tenantId, '2019-01');
  assert.deepEqual(rev, {
    yearMonth: '2019-01',
    breakdown: { commission: 0, entryFees: 0, lateFees: 0, expenses: 0 },
    netCabinetIncome: 0,
  });
});

test("getCabinetRevenue — une pénalité de retard RÉGLÉE entre dans la recette du cabinet, jamais la seule date d'application", async () => {
  // Pénalité appliquée en juin (créance), réglée seulement en juillet — ne doit compter qu'au mois où
  // l'argent est réellement entré (paid_at), jamais au mois d'application (applied_at).
  const [lateFee] = await pool.query(
    `INSERT INTO late_fees (tenant_id, lease_id, amount, applied_at, applied_by) VALUES (:t, :l, 8000, '2026-06-15', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  const revBeforePayment = await getCabinetRevenue(fx.tenantId, '2026-06');
  assert.equal(revBeforePayment.breakdown.lateFees, 0, "appliquée mais pas encore payée : rien en juin");

  await pool.query(
    `INSERT INTO late_fee_payments (tenant_id, late_fee_id, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :lf, 8000, 'especes', '2026-07-05', :by)`,
    { t: fx.tenantId, lf: lateFee.insertId, by: fx.dgId },
  );
  const revAfterPayment = await getCabinetRevenue(fx.tenantId, '2026-07');
  assert.equal(revAfterPayment.breakdown.lateFees, 8000, "réglée en juillet : comptée en juillet");
  assert.equal(revAfterPayment.netCabinetIncome, 8000);

  await pool.query('DELETE FROM late_fee_payments WHERE late_fee_id = :lf', { lf: lateFee.insertId });
  await pool.query('DELETE FROM late_fees WHERE id = :id', { id: lateFee.insertId });
});

// ───── bug corrigé (audit comptable du 30/09/2026) : double déduction de commission en mode 'reversement' ─────

test("getEscrowBalances — gl_commission_timing='reversement' : le solde reste BRUT (la commission n'est prélevée qu'au reversement, jamais deux fois)", async () => {
  // En mode 'reversement' (Comptabilité avancée → Règles comptables), la commission n'est comptabilisée
  // en produit qu'au moment du reversement effectif (`computeReversementDeductions`), jamais à
  // l'encaissement du loyer — le solde séquestre disponible pour un NOUVEAU versement doit donc rester
  // BRUT (sans déduire la commission une première fois ici), sous peine de la prélever deux fois : une
  // première fois silencieusement dans ce calcul, une seconde fois réellement dans l'écriture GL.
  // Fixture ISOLÉE (jamais `fx`, partagé et déjà chargé d'historique par les tests précédents) :
  // `gl_commission_timing` s'applique à TOUT l'historique du tenant d'un coup, un fixture propre est
  // le seul moyen d'isoler l'effet de CE règlement précis sans aucune contamination.
  const iso = await createBareFixture();
  try {
    await setCommissionRate(iso.tenantId, iso.ownerId, iso.dgId, 10); // 10 %
    await pool.query("UPDATE tenants SET gl_commission_timing = 'reversement' WHERE id = :t", { t: iso.tenantId });
    await pool.query(
      `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
       VALUES (:t, :l, '2027-01', 100000, 'virement', '2027-01-05', :by)`,
      { t: iso.tenantId, l: iso.leaseId, by: iso.dgId },
    );

    const balances = await getEscrowBalances(iso.tenantId);
    const b = balances.get(iso.ownerId);
    // BRUT (aucune commission déduite ici) — le bug aurait donné 90000 (taux 10 % déjà retenu deux fois).
    assert.equal(b.totalCollected, 100000);
    assert.equal(b.balance, 100000);

    // Un versement du plein montant brut doit donc être accepté (rejeté à tort si le bug était présent,
    // puisque le solde net calculé par erreur aurait été inférieur de 10000 FCFA à ce montant).
    await assert.doesNotReject(assertPayoutWithinBalance(iso.tenantId, iso.ownerId, 100000));
  } finally {
    await teardown(iso.tenantId);
  }
});

// ───── bug corrigé (audit comptable du 30/09/2026) : arrondi de commission incohérent pour un propriétaire multi-biens ─────

test(
  'getEscrowBalances — propriétaire à PLUSIEURS Biens : le solde agrégé est exactement la SOMME de ce que ' +
    "chaque fiche de Bien afficherait (arrondi Bien par Bien, jamais sur le total combiné du mois)",
  async () => {
    const iso = await createBareFixture();
    try {
      await setCommissionRate(iso.tenantId, iso.ownerId, iso.dgId, 10); // 10 %

      // Second Bien, même propriétaire — même structure que le Bien créé par createBareFixture.
      const [property2] = await pool.query(
        'INSERT INTO properties (tenant_id, code, owner_id, address, created_by) VALUES (:t, :code, :o, :address, :by)',
        { t: iso.tenantId, code: 'GLT-002', o: iso.ownerId, address: 'Adresse test 2', by: iso.dgId },
      );
      await pool.query(
        "INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on) VALUES (:t, :p, :o, '2020-01-01')",
        { t: iso.tenantId, p: property2.insertId, o: iso.ownerId },
      );
      const [unit2] = await pool.query(
        "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'U2', 'studio', 'loue', 33333, :by)",
        { t: iso.tenantId, p: property2.insertId, by: iso.dgId },
      );
      const [renter2] = await pool.query(
        "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Locataire', 'Deux', :phone, :by)",
        { t: iso.tenantId, phone: `04${Math.floor(Math.random() * 100000000)}`, by: iso.dgId },
      );
      const [lease2] = await pool.query(
        "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-01-01', 33333, 5, 33333, 'active', :by)",
        { t: iso.tenantId, r: renter2.insertId, u: unit2.insertId, by: iso.dgId },
      );

      // Même mois, même recette nette (33333) sur les DEUX Biens de ce même propriétaire.
      await pool.query(
        `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
         VALUES (:t, :l1, '2026-05', 33333, 'especes', '2026-05-05', :by), (:t, :l2, '2026-05', 33333, 'especes', '2026-05-05', :by)`,
        { t: iso.tenantId, l1: iso.leaseId, l2: lease2.insertId, by: iso.dgId },
      );

      // Référence : ce que chaque FICHE DE BIEN affiche individuellement.
      const recette1 = await getRecetteProprietaire(iso.tenantId, iso.propertyId, '2026-05');
      const recette2 = await getRecetteProprietaire(iso.tenantId, property2.insertId, '2026-05');
      assert.equal(recette1.commissionCabinet, 3333); // round(33333 * 10%) = 3333.3 -> 3333
      assert.equal(recette2.commissionCabinet, 3333);
      assert.equal(recette1.partProprietaire, 30000);
      assert.equal(recette2.partProprietaire, 30000);
      const sumOfPropertyFiches = recette1.partProprietaire + recette2.partProprietaire; // 60000

      const balances = await getEscrowBalances(iso.tenantId);
      const b = balances.get(iso.ownerId);
      // Le bug aurait arrondi UNE FOIS sur le total combiné (66666 * 10% = 6666.6 -> 6667), donnant 59999.
      assert.equal(b.totalCollected, sumOfPropertyFiches);
      assert.equal(b.totalCollected, 60000);
    } finally {
      await teardown(iso.tenantId);
    }
  },
);

// ───── bug corrigé (Haute #7, étape 51) : dépense « à crédit » pas encore réglée, filtrée à tort sur sa date d'engagement plutôt que son règlement réel ─────

test(
  "getEscrowBalances / getRecetteNetteMaison / getCabinetRevenue — une dépense « à crédit » pas encore réglée ne réduit AUCUNE recette (base caisse réelle), même si sa date d'engagement tombe dans le mois",
  async () => {
    const iso = await createBareFixture();
    try {
      await setCommissionRate(iso.tenantId, iso.ownerId, iso.dgId, 10); // 10 %
      await pool.query(
        `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
         VALUES (:t, :l, '2026-07', 100000, 'especes', '2026-07-05', :by)`,
        { t: iso.tenantId, l: iso.leaseId, by: iso.dgId },
      );
      const [supplier] = await pool.query('INSERT INTO suppliers (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
        t: iso.tenantId,
        n: 'Plombier à crédit (test Haute #7)',
        by: iso.dgId,
      });
      // Engagée (expense_date) DANS le mois consulté, mais toujours IMPAYÉE (payment_status='unpaid',
      // paid_at NULL) — aucun argent n'est réellement sorti : ne doit réduire ni la recette du Bien, ni
      // le solde séquestre, ni la recette du cabinet, avant son règlement effectif.
      await pool.query(
        `INSERT INTO expenses (tenant_id, property_id, category, label, amount, expense_date, supplier_id, payment_status, recorded_by)
         VALUES (:t, :p, 'entretien', 'Fuite non réglée', 15000, '2026-07-10', :s, 'unpaid', :by)`,
        { t: iso.tenantId, p: iso.propertyId, s: supplier.insertId, by: iso.dgId },
      );
      // Dépense de FONCTIONNEMENT du cabinet, elle aussi engagée ce mois-ci mais encore impayée.
      await pool.query(
        `INSERT INTO expenses (tenant_id, property_id, category, label, amount, expense_date, supplier_id, payment_status, recorded_by)
         VALUES (:t, NULL, 'loyer_bureau', 'Loyer bureau non réglé', 8000, '2026-07-12', :s, 'unpaid', :by)`,
        { t: iso.tenantId, s: supplier.insertId, by: iso.dgId },
      );

      const recette = await getRecetteNetteMaison(iso.tenantId, iso.propertyId, '2026-07');
      assert.equal(recette.totalExpenses, 0, "une dépense impayée n'entre dans aucune recette nette de Bien");
      assert.equal(recette.recetteNette, 100000);

      const balances = await getEscrowBalances(iso.tenantId);
      const b = balances.get(iso.ownerId);
      // 100000 - commission (10%) = 90000 — la commission EST normalement déduite ici (mode
      // 'encaissement' par défaut) ; ce qui est testé, c'est l'ABSENCE de toute déduction supplémentaire
      // pour la dépense impayée (le bug aurait donné 90000 - 15000 = 75000).
      assert.equal(b.totalCollected, 90000, "le solde séquestre ne doit pas être amputé d'une dépense jamais réglée");

      const rev = await getCabinetRevenue(iso.tenantId, '2026-07');
      assert.equal(rev.breakdown.expenses, 0, "la recette du cabinet ne doit pas déduire une dépense de fonctionnement impayée");
      assert.equal(rev.breakdown.commission, 10000); // 100000 * 10%, aucune dépense déduite avant

      // Règlement effectif le mois SUIVANT : c'est CE mois-là (paid_at), jamais le mois d'engagement, qui
      // doit désormais porter la déduction.
      await pool.query(
        "UPDATE expenses SET payment_status = 'paid', payment_method = 'virement', paid_at = '2026-08-03' WHERE tenant_id = :t AND property_id = :p",
        { t: iso.tenantId, p: iso.propertyId },
      );
      const recetteJuillet = await getRecetteNetteMaison(iso.tenantId, iso.propertyId, '2026-07');
      assert.equal(recetteJuillet.totalExpenses, 0, 'le mois d\'engagement (juillet) reste à 0 : le règlement a eu lieu en août');
      const recetteAout = await getRecetteNetteMaison(iso.tenantId, iso.propertyId, '2026-08');
      assert.equal(recetteAout.totalExpenses, 15000, 'le mois de règlement réel (août) porte désormais la déduction');
    } finally {
      await teardown(iso.tenantId);
    }
  },
);

// ───── bug corrigé (étape 51bis) : réattribuer le propriétaire d'un Bien réécrivait silencieusement tout son historique financier ─────

test(
  "getEscrowBalances / getRecetteProprietaire — réattribuer le propriétaire d'un Bien NE CHANGE PAS à qui appartenaient les loyers déjà encaissés sous l'ancien",
  async () => {
    const iso = await createBareFixture();
    try {
      await setCommissionRate(iso.tenantId, iso.ownerId, iso.dgId, 10); // Propriétaire A (fixture), 10 %
      const [ownerB] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
        t: iso.tenantId,
        n: 'Propriétaire B (étape 51bis)',
        by: iso.dgId,
      });
      await setCommissionRate(iso.tenantId, ownerB.insertId, iso.dgId, 20); // Propriétaire B, 20 %

      // Loyer de janvier encaissé pendant que A est encore propriétaire.
      await pool.query(
        `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
         VALUES (:t, :l, '2026-01', 100000, 'especes', '2026-01-05', :by)`,
        { t: iso.tenantId, l: iso.leaseId, by: iso.dgId },
      );

      // Réattribution à B le 1er février (frontière de mois nette : la convention « dernier jour du
      // mois » déjà utilisée pour le taux de commission — voir `getTauxCommissionActif` — s'applique de
      // la même façon à l'attribution du propriétaire au niveau mensuel de `getRecetteProprietaire` ; une
      // réattribution EN COURS de mois partagerait un seul mois entre deux propriétaires à ce niveau,
      // scénario volontairement hors de ce test). Reproduit ici ce que fait désormais
      // `PATCH /api/properties/:id` (clôture la période ouverte, en ouvre une nouvelle) en SQL direct
      // (pas de supertest dans ce projet, voir les autres fichiers de ce dossier).
      await pool.query(
        "UPDATE property_owner_history SET ends_on = '2026-02-01' WHERE property_id = :p AND ends_on IS NULL",
        { p: iso.propertyId },
      );
      await pool.query(
        "INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on, set_by) VALUES (:t, :p, :o, '2026-02-01', :by)",
        { t: iso.tenantId, p: iso.propertyId, o: ownerB.insertId, by: iso.dgId },
      );
      await pool.query('UPDATE properties SET owner_id = :o WHERE id = :p', { o: ownerB.insertId, p: iso.propertyId });

      // Loyer de février encaissé APRÈS la réattribution, donc sous B.
      await pool.query(
        `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
         VALUES (:t, :l, '2026-02', 100000, 'especes', '2026-02-05', :by)`,
        { t: iso.tenantId, l: iso.leaseId, by: iso.dgId },
      );

      const balances = await getEscrowBalances(iso.tenantId);
      assert.equal(balances.get(iso.ownerId)?.totalCollected, 90000, 'A garde le loyer de janvier (100000 - 10% de commission), jamais réécrit par la réattribution');
      assert.equal(balances.get(ownerB.insertId)?.totalCollected, 80000, 'B ne reçoit QUE le loyer de février (100000 - 20%), jamais celui de janvier qui appartenait à A');

      // Même vérification au niveau de la fiche du Bien, mois par mois.
      const janvier = await getRecetteProprietaire(iso.tenantId, iso.propertyId, '2026-01');
      assert.equal(janvier.ownerId, iso.ownerId, "janvier reste attribué à A, même si le Bien appartient désormais à B");
      assert.equal(janvier.rate, 10);
      const fevrier = await getRecetteProprietaire(iso.tenantId, iso.propertyId, '2026-02');
      assert.equal(fevrier.ownerId, ownerB.insertId, 'février est bien attribué à B');
      assert.equal(fevrier.rate, 20);
    } finally {
      await teardown(iso.tenantId);
    }
  },
);

test(
  "getEscrowBalances — un paiement antidaté à AVANT la plus ancienne période de property_owner_history retombe sur le propriétaire ACTUEL, jamais perdu du total",
  async () => {
    // Cas réel rencontré en vérifiant ce correctif en direct (tenant 1594) : un paiement de loyer
    // enregistré avec un `paidAt` antérieur à la création du Bien (onboarding d'un locataire déjà en
    // place avant l'usage de Lyko System, saisie rétroactive). Avant le `LEFT JOIN` + `COALESCE`
    // ci-dessus, un tel paiement disparaissait silencieusement du solde séquestre (JOIN strict, aucune
    // période ne le couvrant).
    const iso = await createBareFixture();
    try {
      await setCommissionRate(iso.tenantId, iso.ownerId, iso.dgId, 10);
      // La fixture ouvre sa période dès 2020-01-01 (voir fixtures.js) — on simule ici un Bien dont la
      // période la plus ancienne démarre PLUS TARD que ce paiement, pour reproduire le trou.
      await pool.query("UPDATE property_owner_history SET starts_on = '2026-06-01' WHERE property_id = :p", { p: iso.propertyId });

      await pool.query(
        `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
         VALUES (:t, :l, '2026-01', 60000, 'especes', '2026-01-05', :by)`,
        { t: iso.tenantId, l: iso.leaseId, by: iso.dgId },
      );

      const balances = await getEscrowBalances(iso.tenantId);
      const b = balances.get(iso.ownerId);
      assert.ok(b, "le paiement doit retomber sur le propriétaire actuel, jamais disparaître de l'agrégat");
      assert.equal(b.totalCollected, 54000, '60000 - 10% de commission, comme un paiement normal');
    } finally {
      await teardown(iso.tenantId);
    }
  },
);
