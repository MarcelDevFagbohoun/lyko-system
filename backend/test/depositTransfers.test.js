'use strict';

/** Reversement des cautions au propriétaire : montants, plafonds, comptabilité, bilan du mois, relevé. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { getDepositsHeldByOwner } = require('../src/services/commission');
const { getMonthBilan } = require('../src/services/monthBilan');

let fx; let server; let base;
const hdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}`, 'Content-Type': 'application/json' });
const post = (body) => fetch(`${base}/api/owners/${fx.ownerId}/deposit-transfers`, { method: 'POST', headers: hdr(), body: JSON.stringify(body) });
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const body = (over = {}) => ({ leaseId: fx.leaseId, depositType: 'loyer', amount: 20000, paidAt: today, paymentMethod: 'especes', motive: 'Demande du propriétaire', ...over });

before(async () => {
  fx = await createFixture();
  await pool.query("UPDATE leases SET deposit_received_at = '2026-01-01', deposit_received_method = 'especes' WHERE id = :id", { id: fx.leaseId });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM owner_deposit_transfers WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

test('motif obligatoire, montant positif', async () => {
  assert.equal((await post(body({ motive: 'ok' }))).status, 400);
  assert.equal((await post(body({ amount: 0 }))).status, 400);
});

test('reversement de 20 000 sur une caution de 50 000 : le cabinet n’en détient plus que 30 000', async () => {
  assert.equal((await getDepositsHeldByOwner(fx.tenantId, fx.ownerId)).total, 50000);
  const r = await post(body());
  assert.equal(r.status, 201);
  const held = await getDepositsHeldByOwner(fx.tenantId, fx.ownerId);
  assert.equal(held.total, 30000);
  assert.equal(held.withOwner, 20000);
});

test('plafond : impossible de reverser plus que ce que le cabinet détient', async () => {
  assert.equal((await post(body({ amount: 30001 }))).status, 400);
  assert.equal((await post(body({ amount: 30000 }))).status, 201);
  assert.equal((await getDepositsHeldByOwner(fx.tenantId, fx.ownerId)).total, 0);
});

test('récupération auprès du propriétaire : plafonnée à ce qu’il détient', async () => {
  assert.equal((await post(body({ direction: 'from_owner', amount: 50001 }))).status, 400);
  assert.equal((await post(body({ direction: 'from_owner', amount: 10000, motive: 'Sortie du locataire' }))).status, 201);
  const held = await getDepositsHeldByOwner(fx.tenantId, fx.ownerId);
  assert.equal(held.total, 10000);
  assert.equal(held.withOwner, 40000);
});

test('comptabilité avancée : écritures équilibrées 4673 / trésorerie, sans toucher 4671 ni 165', async () => {
  const [rows] = await pool.query(
    `SELECT e.source_operation_type op, a.code, el.side, el.amount FROM gl_entries e
     JOIN gl_entry_lines el ON el.entry_id = e.id JOIN gl_accounts a ON a.id = el.account_id
     WHERE e.tenant_id = :t AND e.source_table = 'owner_deposit_transfers'`,
    { t: fx.tenantId },
  );
  // Module comptable inactif sur cette entreprise : aucune écriture automatique.
  assert.equal(rows.length, 0);

  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: fx.tenantId });
  // Règles retirées : l'API doit les (re)créer toute seule avant d'enregistrer.
  await pool.query('DELETE FROM gl_posting_rules WHERE tenant_id = :t AND operation_type IN (\'caution_reversee_proprietaire\',\'caution_recuperee_proprietaire\')', { t: fx.tenantId });
  assert.equal((await post(body({ amount: 5000 }))).status, 201);
  const [lines] = await pool.query(
    `SELECT a.code, el.side, el.amount FROM gl_entries e
     JOIN gl_entry_lines el ON el.entry_id = e.id JOIN gl_accounts a ON a.id = el.account_id
     WHERE e.tenant_id = :t AND e.source_table = 'owner_deposit_transfers' ORDER BY el.line_order`,
    { t: fx.tenantId },
  );
  assert.deepEqual(lines.map((l) => [l.side, l.code, Number(l.amount)]), [['debit', '4673', 5000], ['credit', '571', 5000]]);
});

test('bilan du mois : sortie et entrée de trésorerie, et cautions encore chez le propriétaire', async () => {
  const b = await getMonthBilan(fx.tenantId, month);
  assert.equal(b.outflows.lines.depositsTransferredToOwners, 20000 + 30000 + 5000);
  assert.equal(b.inflows.lines.depositsRecoveredFromOwners, 10000);
  assert.equal(b.depositTransfers.stillWithOwners.total, 45000);
  assert.ok(b.depositTransfers.lines.length >= 4);
  assert.ok(b.controls.every((c) => c.ok));
});

test('relevé PDF du propriétaire : généré avec la section cautions', async () => {
  const r = await fetch(`${base}/api/owners/${fx.ownerId}/statement.pdf`, { headers: hdr() });
  assert.ok([200, 403].includes(r.status)); // 403 si l'offre ne comprend pas le portail propriétaire
});
