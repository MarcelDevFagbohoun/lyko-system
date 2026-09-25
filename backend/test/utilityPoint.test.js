'use strict';

/**
 * Étape 30 — « Le point des charges » (services/utilityPoint.js) : facture
 * mère payée par le propriétaire vs charges réellement encaissées chez les
 * locataires. Fixtures GL réutilisées uniquement pour créer un
 * tenant/propriétaire/bien/bail jetables.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { getUtilityPoint, getBatchPoint, computeBatchPoint } = require('../src/services/utilityPoint');
const { createBareFixture } = require('./gl/fixtures');

let fx;
let secondLeaseId;
let secondUnitId;
let secondRenterId;

async function insertBatch({ periodStart, periodEnd, mainInvoice, mainPaid = null, status = 'valide' }) {
  const [r] = await pool.query(
    `INSERT INTO utility_reading_batches
       (tenant_id, property_id, utility_type, period_start, period_end, unit_price,
        main_reading_start, main_reading_end, main_invoice_amount, main_paid_amount, main_paid_at,
        status, validated_at, recorded_by)
     VALUES (:t, :p, 'soneb', :ps, :pe, 100, 0, 1000, :inv, :paid, :paidAt, :status, NOW(), :by)`,
    {
      t: fx.tenantId,
      p: fx.propertyId,
      ps: periodStart,
      pe: periodEnd,
      inv: mainInvoice,
      paid: mainPaid,
      paidAt: mainPaid != null ? periodEnd : null,
      status,
      by: fx.dgId,
    },
  );
  return r.insertId;
}

/** Une facture locataire rattachée au relevé via sa ligne de relevé (comme à la validation). */
async function insertCharge(batchId, { unitId, leaseId, amount, paid = 0, periodStart, periodEnd }) {
  const status = paid >= amount ? 'payee' : paid > 0 ? 'partiellement_payee' : 'impayee';
  const [c] = await pool.query(
    `INSERT INTO utility_charges
       (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price,
        amount, billed_at, status, recorded_by)
     VALUES (:t, :l, 'soneb', :ps, :pe, 0, 10, 100, :amount, :pe, :status, :by)`,
    { t: fx.tenantId, l: leaseId, ps: periodStart, pe: periodEnd, amount, status, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO utility_readings (tenant_id, batch_id, unit_id, lease_id, reading_start, reading_end, amount, charge_id)
     VALUES (:t, :b, :u, :l, 0, 10, :amount, :c)`,
    { t: fx.tenantId, b: batchId, u: unitId, l: leaseId, amount, c: c.insertId },
  );
  if (paid > 0) {
    await pool.query(
      `INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by)
       VALUES (:t, :c, :amount, 'especes', :pe, :by)`,
      { t: fx.tenantId, c: c.insertId, amount: paid, pe: periodEnd, by: fx.dgId },
    );
  }
  return c.insertId;
}

before(async () => {
  fx = await createBareFixture();
  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'U2', 'studio', 'loue', 50000, :by)",
    { t: fx.tenantId, p: fx.propertyId, by: fx.dgId },
  );
  secondUnitId = unit.insertId;
  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Second', 'Test', :phone, :by)",
    { t: fx.tenantId, phone: `07${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  secondRenterId = renter.insertId;
  const [lease] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-01-01', 50000, 5, 0, 'active', :by)",
    { t: fx.tenantId, r: secondRenterId, u: secondUnitId, by: fx.dgId },
  );
  secondLeaseId = lease.insertId;
});

after(async () => {
  const p = { tenantId: fx.tenantId };
  await pool.query('DELETE FROM utility_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_readings WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_charges WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_reading_batches WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM leases WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM renters WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM property_units WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM properties WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owners WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM users WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM tenants WHERE id = :tenantId', p);
  await closePool();
});

test('computeBatchPoint — statut selon la priorité : paiement non renseigné > à recouvrer > à charge du propriétaire > soldé', () => {
  const base = { id: 1, property_id: 1, property_code: 'X', owner_id: 1, owner_name: 'O', utility_type: 'soneb', period_start: '2026-08-01', period_end: '2026-08-31', charges_count: 2, unpaid_charges_count: 0 };
  assert.equal(computeBatchPoint({ ...base, main_invoice_amount: 100, main_paid_amount: null, billed: 100, collected: 100 }).status, 'paiement_non_renseigne');
  assert.equal(computeBatchPoint({ ...base, main_invoice_amount: 100, main_paid_amount: 100, billed: 100, collected: 60 }).status, 'a_recouvrer');
  assert.equal(computeBatchPoint({ ...base, main_invoice_amount: 100, main_paid_amount: 100, billed: 70, collected: 70 }).status, 'a_charge_proprietaire');
  assert.equal(computeBatchPoint({ ...base, main_invoice_amount: 100, main_paid_amount: 100, billed: 100, collected: 100 }).status, 'solde');
  // Le propriétaire a payé MOINS que ce qui a été encaissé (ex. pénalité négociée) : couvert, jamais négatif côté statut.
  const surplus = computeBatchPoint({ ...base, main_invoice_amount: 100, main_paid_amount: 80, billed: 100, collected: 100 });
  assert.equal(surplus.status, 'solde');
  assert.equal(surplus.gap, -20);
});

test('getUtilityPoint — décomposition du reste à charge : conso non refacturée + impayés locataires, puis règlement des impayés', async () => {
  const batchId = await insertBatch({ periodStart: '2026-08-01', periodEnd: '2026-08-31', mainInvoice: 100000, mainPaid: 100000 });
  const c1 = await insertCharge(batchId, { unitId: fx.unitId, leaseId: fx.leaseId, amount: 40000, paid: 40000, periodStart: '2026-08-01', periodEnd: '2026-08-31' });
  const c2 = await insertCharge(batchId, { unitId: secondUnitId, leaseId: secondLeaseId, amount: 30000, paid: 10000, periodStart: '2026-08-01', periodEnd: '2026-08-31' });

  let res = await getUtilityPoint(fx.tenantId, { ownerId: fx.ownerId, fromMonth: '2026-08', toMonth: '2026-08' });
  assert.equal(res.owners.length, 1);
  let b = res.owners[0].batches[0];
  assert.equal(b.mainInvoice, 100000);
  assert.equal(b.mainPaid, 100000);
  assert.equal(b.billed, 70000);
  assert.equal(b.collected, 50000);
  assert.equal(b.tenantUnpaid, 20000, 'impayés locataires = facturé − encaissé');
  assert.equal(b.nonRebilled, 30000, 'conso non refacturée = facture payée − facturé');
  assert.equal(b.gap, 50000, 'reste à charge = facture payée − encaissé');
  assert.equal(b.gap, b.nonRebilled + b.tenantUnpaid);
  assert.equal(b.status, 'a_recouvrer');
  assert.equal(b.unpaidChargesCount, 1);
  assert.equal(res.totals.gapTotal, 50000);

  // Le locataire solde : il ne reste plus que la perte de consommation non refacturée.
  await pool.query(
    "INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by) VALUES (:t, :c, 20000, 'especes', '2026-09-05', :by)",
    { t: fx.tenantId, c: c2, by: fx.dgId },
  );
  await pool.query("UPDATE utility_charges SET status = 'payee' WHERE id = :c", { c: c2 });
  res = await getUtilityPoint(fx.tenantId, { ownerId: fx.ownerId, fromMonth: '2026-08', toMonth: '2026-08' });
  b = res.owners[0].batches[0];
  assert.equal(b.collected, 70000);
  assert.equal(b.tenantUnpaid, 0);
  assert.equal(b.gap, 30000);
  assert.equal(b.status, 'a_charge_proprietaire', 'plus rien à recouvrer : la perte restante est définitive');

  // Une facture supprimée logiquement sort de B ET de C (comme partout ailleurs).
  await pool.query('UPDATE utility_charges SET deleted_at = NOW() WHERE id = :c', { c: c1 });
  res = await getUtilityPoint(fx.tenantId, { ownerId: fx.ownerId, fromMonth: '2026-08', toMonth: '2026-08' });
  b = res.owners[0].batches[0];
  assert.equal(b.billed, 30000);
  assert.equal(b.collected, 30000);
  assert.equal(b.gap, 70000);
});

test('getUtilityPoint — relevé sans paiement de facture mère déclaré, brouillon exclu, plage de mois et périmètre agent respectés', async () => {
  const pendingId = await insertBatch({ periodStart: '2026-10-01', periodEnd: '2026-10-31', mainInvoice: 80000, mainPaid: null });
  await insertCharge(pendingId, { unitId: fx.unitId, leaseId: fx.leaseId, amount: 25000, paid: 25000, periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  await insertBatch({ periodStart: '2026-11-01', periodEnd: '2026-11-30', mainInvoice: 90000, mainPaid: null, status: 'brouillon' });

  const res = await getUtilityPoint(fx.tenantId, { fromMonth: '2026-10', toMonth: '2026-11' });
  assert.equal(res.owners.length, 1);
  assert.equal(res.owners[0].batches.length, 1, 'le brouillon de novembre n\'apparaît pas');
  const b = res.owners[0].batches[0];
  assert.equal(b.status, 'paiement_non_renseigne');
  assert.equal(b.gap, null, 'aucun reste à charge calculable tant que la facture mère n\'est pas déclarée payée');
  assert.equal(b.collected, 25000);
  assert.equal(res.totals.pendingPaymentCount, 1);
  assert.equal(res.totals.pendingInvoiceAmount, 80000);
  assert.equal(res.totals.gapTotal, 0, 'un relevé non payé ne pèse pas dans le solde');

  const outOfRange = await getUtilityPoint(fx.tenantId, { fromMonth: '2026-01', toMonth: '2026-06' });
  assert.equal(outOfRange.owners.length, 0);

  // Un agent restreint ne voit que les Biens qui lui sont attribués (ici : aucun).
  const scoped = await getUtilityPoint(fx.tenantId, { fromMonth: '2026-08', toMonth: '2026-10', scopeAgentId: fx.dgId });
  assert.equal(scoped.owners.length, 0);

  const one = await getBatchPoint(fx.tenantId, pendingId);
  assert.equal(one.batchId, pendingId);
  assert.equal(await getBatchPoint(fx.tenantId, pendingId, fx.dgId), null, 'hors périmètre agent : introuvable');
});
