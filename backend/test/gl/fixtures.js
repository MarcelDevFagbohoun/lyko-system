'use strict';

/**
 * Fixtures de test pour le module comptable — crée un tenant JETABLE complet
 * (jamais KIko Store) avec plan comptable initialisé, un exercice ouvert,
 * un propriétaire/bien/bail. `teardown()` supprime tout en fin de test.
 */

const { pool } = require('../../src/config/db');
const { seed } = require('../../src/db/seedGeneralLedger');

/**
 * Tenant + propriétaire/bien/bail, SANS plan comptable ni exercice — pour
 * tester l'activation elle-même (`glActivationService`) à partir d'un état
 * réellement vierge, comme un vrai tenant qui n'a jamais utilisé la
 * comptabilité avancée.
 */
async function createBareFixture() {
  const [t] = await pool.query(
    'INSERT INTO tenants (company_name, rccm, ifu, contact_phone) VALUES (:name, :rccm, :ifu, :phone)',
    { name: `GL Test ${Date.now()}`, rccm: 'RCCM-TEST', ifu: 'IFU-TEST', phone: `01${Math.floor(Math.random() * 100000000)}` },
  );
  const tenantId = t.insertId;

  const [dg] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:tenantId, 'dg', 'DG', 'Test', :phone, 'x')",
    { tenantId, phone: `02${Math.floor(Math.random() * 100000000)}` },
  );
  const dgId = dg.insertId;

  const [owner] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:tenantId, :name, :by)', {
    tenantId,
    name: 'Propriétaire Test',
    by: dgId,
  });
  const ownerId = owner.insertId;

  const [property] = await pool.query(
    'INSERT INTO properties (tenant_id, code, owner_id, address, created_by) VALUES (:tenantId, :code, :ownerId, :address, :by)',
    { tenantId, code: 'GLT-001', ownerId, address: 'Adresse test', by: dgId },
  );
  const propertyId = property.insertId;

  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:tenantId, :propertyId, 'U1', 'studio', 'loue', 50000, :by)",
    { tenantId, propertyId, by: dgId },
  );
  const unitId = unit.insertId;

  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:tenantId, 'Locataire', 'Test', :phone, :by)",
    { tenantId, phone: `03${Math.floor(Math.random() * 100000000)}`, by: dgId },
  );
  const renterId = renter.insertId;

  const [lease] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:tenantId, :renterId, :unitId, '2026-01-01', 50000, 5, 50000, 'active', :by)",
    { tenantId, renterId, unitId, by: dgId },
  );
  const leaseId = lease.insertId;

  return { tenantId, dgId, ownerId, propertyId, unitId, renterId, leaseId };
}

async function createFixture() {
  const bare = await createBareFixture();
  await seed(bare.tenantId);
  const [fy] = await pool.query(
    "INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:tenantId, '2026', '2026-01-01', '2026-12-31', 'ouvert')",
    { tenantId: bare.tenantId },
  );
  return { ...bare, fiscalYearId: fy.insertId };
}

async function setCommissionRate(tenantId, ownerId, dgId, rate) {
  await pool.query(
    "INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, set_by) VALUES (:tenantId, :ownerId, :rate, '2026-01-01', :by)",
    { tenantId, ownerId, rate, by: dgId },
  );
}

/**
 * Supprime tout ce que `createFixture` a créé, dans l'ordre des dépendances.
 * DELETE explicite (pas seulement des CASCADE) pour que le test échoue
 * bruyamment si une table est oubliée, plutôt que de laisser des résidus
 * silencieux dans la base partagée de développement.
 */
async function teardown(tenantId) {
  const p = { tenantId };
  await pool.query(
    `DELETE brl FROM gl_bank_reconciliation_lines brl
     JOIN gl_bank_reconciliations br ON br.id = brl.reconciliation_id WHERE br.tenant_id = :tenantId`,
    p,
  );
  await pool.query('DELETE FROM gl_bank_reconciliations WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE el FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id WHERE e.tenant_id = :tenantId', p);
  await pool.query('DELETE FROM gl_entries WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM gl_entry_number_counters WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM gl_notifications WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM gl_audit_log WHERE tenant_id = :tenantId', p);
  await pool.query(
    'DELETE prl FROM gl_posting_rule_lines prl JOIN gl_posting_rules pr ON pr.id = prl.rule_id WHERE pr.tenant_id = :tenantId',
    p,
  );
  await pool.query('DELETE FROM gl_posting_rules WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM gl_third_parties WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM gl_fiscal_years WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM gl_journals WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM gl_accounts WHERE tenant_id = :tenantId', p);
  // Opérations métier pré-existantes (utilisées par les tests d'activation/
  // rattrapage) — sans effet pour un test qui n'en a créé aucune.
  await pool.query('DELETE FROM receipts WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM rent_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_charges WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM late_fees WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM lease_opening_debt_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM lease_balance_snapshots WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM expenses WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM fixed_asset_depreciations WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM fixed_assets WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM suppliers WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owner_payouts WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owner_commission_rates WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM leases WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM renters WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM property_units WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM properties WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owners WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM users WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM tenants WHERE id = :tenantId', p);
}

module.exports = { createFixture, createBareFixture, setCommissionRate, teardown };
