'use strict';
/**
 * Refonte du 21/10/2026 : la commission d'un loyer est calculée au taux EN VIGUEUR AU JOUR DE
 * L'ENCAISSEMENT (pas au dernier jour du mois, pas au mois couvert), et tout est rangé par mois
 * d'encaissement — fiche du Bien, séquestre et revenu du cabinet doivent donner les mêmes chiffres.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const commission = require('../src/services/commission');
const { createFixture, teardown } = require('./gl/fixtures');

let fx;
test.before(async () => {
  fx = await createFixture();
  const T = fx.tenantId;
  await pool.query("INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, ends_on, set_by) VALUES (:T,:o,10,'2026-01-01','2026-09-30',:by)", { T, o: fx.ownerId, by: fx.dgId });
  await pool.query("INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, set_by) VALUES (:T,:o,15,'2026-10-01',:by)", { T, o: fx.ownerId, by: fx.dgId });
  const pay = (covers, amount, paidAt) =>
    pool.query(
      "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by) VALUES (:T,:l,:c,:cs,:a,'virement',:p,:by)",
      { T, l: fx.leaseId, c: covers, cs: `${covers}-01`, a: amount, p: paidAt, by: fx.dgId },
    );
  await pay('2026-09', 50000, '2026-09-03');
  await pay('2026-10', 50000, '2026-09-28'); // d'avance : taux de septembre (10 %)
  await pay('2026-11', 50000, '2026-09-28');
  await pay('2026-10', 20000, '2026-10-05'); // encaissé après le changement : 15 %
});
test.after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('fiche du Bien : loyers rangés par mois d\'encaissement, taux du jour du paiement', async () => {
  const sept = await commission.getRecetteProprietaire(fx.tenantId, fx.propertyId, '2026-09');
  assert.equal(sept.recetteNette, 150000);
  assert.equal(sept.commissionCabinet, 15000); // 10 % sur 150 000 (et non 15 %)
  const oct = await commission.getRecetteProprietaire(fx.tenantId, fx.propertyId, '2026-10');
  assert.equal(oct.recetteNette, 20000);
  assert.equal(oct.commissionCabinet, 3000);
});

test('séquestre = Σ fiches des Biens ; reconstruction au 30/09 exclut octobre', async () => {
  const now = (await commission.getEscrowBalances(fx.tenantId)).get(fx.ownerId);
  assert.equal(now.totalCollected, 135000 + 17000);
  const sept = (await commission.getEscrowBalances(fx.tenantId, pool, '2026-09-30')).get(fx.ownerId);
  assert.equal(sept.totalCollected, 135000);
});

test('revenu du cabinet : même commission que la fiche du Bien, par mois', async () => {
  assert.equal((await commission.getCabinetRevenue(fx.tenantId, '2026-09')).breakdown.commission, 15000);
  assert.equal((await commission.getCabinetRevenue(fx.tenantId, '2026-10')).breakdown.commission, 3000);
});
