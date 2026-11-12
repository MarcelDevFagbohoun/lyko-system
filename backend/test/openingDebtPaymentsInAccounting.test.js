'use strict';

/**
 * « Il faut que tous ces changements soient dans les opérations trésorerie » (demande utilisateur,
 * 2026-11-12, juste après les deux fonctionnalités d'impayés à l'entrée) : les règlements d'impayés à
 * l'entrée — globaux (ancien comportement) et par poste (type + mois, migration 151) — doivent
 * apparaître dans la page Comptabilité ("Trésorerie & recettes"), au même titre que les paiements de
 * loyer et les versements aux propriétaires. Vérifie la nouvelle route
 * GET /api/accounting/opening-debt-payments.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const leasePayments = require('../src/services/leasePayments');

let fx; let server; let base;
const hdr = (userId, role) => ({ Authorization: `Bearer ${signAccessToken({ sub: userId, tenantId: fx.tenantId, role })}` });

before(async () => {
  fx = await createFixture();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await teardown(fx.tenantId);
  await closePool();
});

test('un règlement global d\'impayé à l\'entrée apparaît dans /opening-debt-payments', async () => {
  await pool.query('UPDATE leases SET opening_debt_amount = 20000 WHERE id = :id', { id: fx.leaseId });
  await leasePayments.payOpeningDebt(fx.tenantId, fx.dgId, fx.leaseId, null, {
    amount: 20000,
    paymentMethod: 'especes',
    paidAt: '2026-11-05',
  });

  const r = await fetch(`${base}/api/accounting/opening-debt-payments?from=2026-11-01&to=2026-11-30`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.payments.length, 1);
  assert.equal(body.payments[0].amount, 20000);
  assert.equal(body.payments[0].item, null);
  assert.equal(body.payments[0].leaseId, fx.leaseId);

  // Nettoyage pour le test suivant (même bail).
  await pool.query('DELETE FROM lease_opening_debt_payments WHERE lease_id = :id', { id: fx.leaseId });
  await pool.query('UPDATE leases SET opening_debt_amount = 0 WHERE id = :id', { id: fx.leaseId });
});

test('un règlement de poste (type + mois) apparaît avec son détail', async () => {
  const [item] = await pool.query(
    `INSERT INTO lease_opening_debt_items (tenant_id, lease_id, debt_type, period_month, label, amount, created_by)
     VALUES (:t, :l, 'sbee', '2026-10', 'Facture en retard', 15000, :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  await pool.query('UPDATE leases SET opening_debt_amount = 15000 WHERE id = :id', { id: fx.leaseId });

  await leasePayments.payOpeningDebtItem(fx.tenantId, fx.dgId, fx.leaseId, item.insertId, null, {
    amount: 15000,
    paymentMethod: 'mobile_money',
    paidAt: '2026-11-07',
  });

  const r = await fetch(`${base}/api/accounting/opening-debt-payments?from=2026-11-01&to=2026-11-30`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.payments.length, 1);
  assert.equal(body.payments[0].amount, 15000);
  assert.ok(body.payments[0].item);
  assert.equal(body.payments[0].item.debtType, 'sbee');
  assert.equal(body.payments[0].item.periodMonth, '2026-10');
  assert.equal(body.payments[0].item.label, 'Facture en retard');
});

test('un agent sans la permission « comptabilite » ne peut pas accéder à ce registre (403)', async () => {
  const [agent] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'agent', 'Agent', 'Test', :phone, 'x')",
    { t: fx.tenantId, phone: `06${Math.floor(Math.random() * 100000000)}` },
  );
  const r = await fetch(`${base}/api/accounting/opening-debt-payments?from=2026-11-01&to=2026-11-30`, { headers: hdr(agent.insertId, 'agent') });
  assert.equal(r.status, 403);
  await pool.query('DELETE FROM users WHERE id = :id', { id: agent.insertId });
});
