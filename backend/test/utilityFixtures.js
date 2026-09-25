'use strict';

/**
 * Aides de test pour le suivi des charges SONEB/SBEE (étapes 30-31) : relevé,
 * factures locataires, règlements, deuxième unité/bail, nettoyage — au-dessus
 * des fixtures GL (`createBareFixture`), qui ne fournissent qu'un
 * tenant/propriétaire/bien/unité/bail jetables.
 */

const { pool } = require('../src/config/db');

async function insertBatch(fx, o) {
  const [r] = await pool.query(
    `INSERT INTO utility_reading_batches
       (tenant_id, property_id, utility_type, period_start, period_end, unit_price,
        main_reading_start, main_reading_end, main_invoice_amount, main_paid_amount, main_paid_at,
        status, validated_at, recorded_by, created_at)
     VALUES (:t, :p, :ut, :ps, :pe, 100, :mrs, :mre, :inv, :paid, :paidAt, :status, :validatedAt, :by, :createdAt)`,
    {
      t: fx.tenantId,
      p: o.propertyId ?? fx.propertyId,
      ut: o.utilityType ?? 'soneb',
      ps: o.periodStart,
      pe: o.periodEnd,
      mrs: o.mainReadingStart === undefined ? 0 : o.mainReadingStart,
      mre: o.mainReadingEnd === undefined ? 1000 : o.mainReadingEnd,
      inv: o.mainInvoice ?? 100000,
      paid: o.mainPaid ?? null,
      paidAt: o.mainPaid != null ? o.periodEnd : null,
      status: o.status ?? 'valide',
      validatedAt: o.validatedAt ?? (o.status === 'brouillon' ? null : `${o.periodEnd} 12:00:00`),
      by: fx.dgId,
      createdAt: o.createdAt ?? `${o.periodStart} 08:00:00`,
    },
  );
  return r.insertId;
}

/** Une facture locataire (+ sa ligne de relevé si `batchId`) et, si `paid` > 0, un règlement. */
async function insertCharge(fx, { batchId = null, unitId, leaseId, amount, paid = 0, paidAt, periodStart, periodEnd, readingEnd = 10, utilityType = 'soneb', deleted = false }) {
  const status = paid >= amount ? 'payee' : paid > 0 ? 'partiellement_payee' : 'impayee';
  const [c] = await pool.query(
    `INSERT INTO utility_charges
       (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price,
        amount, billed_at, status, recorded_by, deleted_at)
     VALUES (:t, :l, :ut, :ps, :pe, 0, :re, 100, :amount, :pe, :status, :by, :deletedAt)`,
    {
      t: fx.tenantId, l: leaseId, ut: utilityType, ps: periodStart, pe: periodEnd, re: readingEnd,
      amount, status, by: fx.dgId, deletedAt: deleted ? '2026-11-01 10:00:00' : null,
    },
  );
  if (batchId != null) {
    await pool.query(
      `INSERT INTO utility_readings (tenant_id, batch_id, unit_id, lease_id, reading_start, reading_end, amount, charge_id)
       VALUES (:t, :b, :u, :l, 0, :re, :amount, :c)`,
      { t: fx.tenantId, b: batchId, u: unitId, l: leaseId, re: readingEnd, amount, c: c.insertId },
    );
  }
  if (paid > 0) {
    await pool.query(
      `INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by)
       VALUES (:t, :c, :amount, 'especes', :paidAt, :by)`,
      { t: fx.tenantId, c: c.insertId, amount: paid, paidAt: paidAt ?? periodEnd, by: fx.dgId },
    );
  }
  return c.insertId;
}

async function insertRemittance(fx, { ownerId, amount, paidAt, deleted = false, periodLabel = null }) {
  const [r] = await pool.query(
    `INSERT INTO owner_charge_remittances (tenant_id, owner_id, amount, period_label, paid_at, payment_method, recorded_by, deleted_at, deleted_by, deleted_reason)
     VALUES (:t, :o, :amount, :label, :paidAt, 'virement', :by, :deletedAt, :deletedBy, :reason)`,
    {
      t: fx.tenantId, o: ownerId ?? fx.ownerId, amount, label: periodLabel, paidAt, by: fx.dgId,
      deletedAt: deleted ? '2026-11-02 10:00:00' : null,
      deletedBy: deleted ? fx.dgId : null,
      reason: deleted ? 'Saisie erronée' : null,
    },
  );
  return r.insertId;
}

/** Deuxième unité + locataire + bail actif sur le Bien de la fixture (une ligne de relevé par unité). */
async function addSecondUnit(fx, code = 'U2') {
  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, :code, 'studio', 'loue', 50000, :by)",
    { t: fx.tenantId, p: fx.propertyId, code, by: fx.dgId },
  );
  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Second', :ln, :phone, :by)",
    { t: fx.tenantId, ln: `Loc${code}`, phone: `07${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [lease] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-01-01', 50000, 5, 0, 'active', :by)",
    { t: fx.tenantId, r: renter.insertId, u: unit.insertId, by: fx.dgId },
  );
  return { unitId: unit.insertId, renterId: renter.insertId, leaseId: lease.insertId };
}

async function cleanupUtility(tenantId) {
  const p = { tenantId };
  await pool.query('DELETE FROM gl_notifications WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owner_charge_remittances WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_readings WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_charges WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_reading_batches WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM document_issuances WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM leases WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM renters WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM property_units WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM properties WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owners WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM users WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM tenants WHERE id = :tenantId', p);
}

module.exports = { insertBatch, insertCharge, insertRemittance, addSecondUnit, cleanupUtility };
