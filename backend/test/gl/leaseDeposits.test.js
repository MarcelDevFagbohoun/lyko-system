'use strict';

/**
 * Cautions supplémentaires (étape 43, migration 068) — SBEE/SONEB (garantie contre les impayés de
 * charges, réglés RÉELLEMENT via `utility_payments`) et peinture (retenue manuelle, dépassement
 * reporté sur la caution de loyer). Même précédent que `test/gl/entryFee.test.js`/`openingDebt.test.js`.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { backfillHistoricalEntries } = require('../../src/services/gl/glActivationService');
const {
  recordAdditionalDeposits,
  listLeaseDeposits,
  getUnpaidUtilityBalance,
  finalizeAdditionalDeposits,
} = require('../../src/services/leaseDeposits');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
  // Le plan comptable/journaux/règles existent déjà (seed() dans createFixture), mais le module doit
  // aussi être marqué ACTIF pour que recordAdditionalDeposits/finalizeAdditionalDeposits (gate interne
  // via isModuleActive) postent réellement leurs écritures — comme une entreprise qui a déjà activé
  // la comptabilité avancée.
  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: fx.tenantId });
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

beforeEach(async () => {
  const p = { tenantId: fx.tenantId };
  await pool.query('DELETE FROM utility_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_charges WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM lease_deposits WHERE tenant_id = :tenantId', p);
  await pool.query(
    'DELETE el FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id WHERE e.tenant_id = :tenantId',
    p,
  );
  await pool.query('DELETE FROM gl_entries WHERE tenant_id = :tenantId', p);
});

async function insertCharge({ utilityType, amount, paid = 0, billedAt = '2026-08-31' }) {
  const status = paid >= amount ? 'payee' : paid > 0 ? 'partiellement_payee' : 'impayee';
  const [c] = await pool.query(
    `INSERT INTO utility_charges (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by)
     VALUES (:t, :l, :type, '2026-08-01', '2026-08-31', 0, 10, 100, :amount, :billedAt, :status, :by)`,
    { t: fx.tenantId, l: fx.leaseId, type: utilityType, amount, billedAt, status, by: fx.dgId },
  );
  if (paid > 0) {
    await pool.query(
      "INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by) VALUES (:t, :c, :paid, 'especes', :billedAt, :by)",
      { t: fx.tenantId, c: c.insertId, paid, billedAt, by: fx.dgId },
    );
  }
  return c.insertId;
}

const RENTER_NAME = 'Locataire Test';

test('genererEcriture — caution_supplementaire_recue : compte 165 unique, aucune commission (liability, pas un revenu)', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const received = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'caution_supplementaire_recue',
      entryDate: '2026-08-01',
      amount: 15000,
      paymentMethod: 'especes',
      narrationVars: { type: 'Caution SBEE (électricité)', locataire: RENTER_NAME },
      sourceTable: 'lease_deposits',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();
    assert.equal(received.lines.length, 2, 'trésorerie + 165 uniquement, jamais de commission');
    const [lines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: received.entryId },
    );
    assert.deepEqual(lines.map((l) => [l.side, l.code, Number(l.amount)]), [
      ['debit', '571', 15000],
      ['credit', '165', 15000],
    ]);
    const [[entry]] = await pool.query('SELECT narration FROM gl_entries WHERE id = :id', { id: received.entryId });
    assert.equal(entry.narration, 'Caution SBEE (électricité) reçue — Locataire Test');
  } finally {
    conn.release();
  }
});

test('genererEcriture — caution_supplementaire_restituee : symétrique, même compte 165, aucune commission', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const returned = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'caution_supplementaire_restituee',
      entryDate: '2026-09-28',
      amount: 9000,
      paymentMethod: 'mobile_money',
      narrationVars: { type: 'Caution SBEE (électricité)', locataire: RENTER_NAME },
      sourceTable: 'lease_deposits_return',
      sourceId: 1,
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();
    const [lines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: returned.entryId },
    );
    assert.deepEqual(lines.map((l) => [l.side, l.code, Number(l.amount)]), [
      ['debit', '165', 9000],
      ['credit', '552', 9000], // mobile_money → 552 (voir PAYMENT_METHOD_ACCOUNTS, seedGeneralLedger.js)
    ]);
    const [[entry]] = await pool.query('SELECT narration FROM gl_entries WHERE id = :id', { id: returned.entryId });
    assert.equal(entry.narration, 'Caution SBEE (électricité) restituée — Locataire Test');
  } finally {
    conn.release();
  }
});

test("recordAdditionalDeposits — deux types sur le même bail, chacun sa ligne ET sa propre écriture (jamais ignorée par un identifiant partagé)", async () => {
  const tenantRow = { deposit_sbee_enabled: 1, deposit_soneb_enabled: 1, deposit_peinture_enabled: 0 };
  await pool.query('UPDATE tenants SET deposit_sbee_enabled = 1, deposit_soneb_enabled = 1 WHERE id = :t', { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await recordAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
      enabledTenantRow: tenantRow,
      entries: {
        sbee: { amount: 15000, paymentMethod: 'especes', paidAt: '2026-08-01' },
        soneb: { amount: 10000, paymentMethod: 'mobile_money', paidAt: '2026-08-01' },
      },
    });
    await conn.commit();
  } finally {
    conn.release();
  }

  const deposits = await listLeaseDeposits(fx.tenantId, fx.leaseId);
  assert.deepEqual(deposits.map((d) => [d.type, d.amount, d.status]).sort(), [
    ['sbee', 15000, 'held'],
    ['soneb', 10000, 'held'],
  ]);
  const [[{ n }]] = await pool.query(
    "SELECT COUNT(*) AS n FROM gl_entries WHERE tenant_id = :t AND source_table = 'lease_deposits' AND source_operation_type = 'caution_supplementaire_recue'",
    { t: fx.tenantId },
  );
  assert.equal(Number(n), 2, 'une écriture par type, jamais une ignorée');
});

test("recordAdditionalDeposits — un type NON activé pour l'entreprise est ignoré silencieusement (jamais une erreur)", async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await recordAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
      enabledTenantRow: { deposit_sbee_enabled: 0, deposit_soneb_enabled: 0, deposit_peinture_enabled: 0 },
      entries: { peinture: { amount: 20000, paymentMethod: 'especes', paidAt: '2026-08-01' } },
    });
    await conn.commit();
  } finally {
    conn.release();
  }
  assert.deepEqual(await listLeaseDeposits(fx.tenantId, fx.leaseId), []);
});

test('getUnpaidUtilityBalance — facturé moins encaissé, jamais négatif, factures supprimées exclues', async () => {
  await insertCharge({ utilityType: 'sbee', amount: 12000, paid: 4000 });
  assert.equal(await getUnpaidUtilityBalance(pool, fx.tenantId, fx.leaseId, 'sbee'), 8000);
  await pool.query("UPDATE utility_charges SET status='payee' WHERE tenant_id=:t", { t: fx.tenantId });
  await pool.query('UPDATE utility_charges SET deleted_at = NOW() WHERE tenant_id = :t', { t: fx.tenantId });
  assert.equal(await getUnpaidUtilityBalance(pool, fx.tenantId, fx.leaseId, 'sbee'), 0);
});

test('finalizeAdditionalDeposits — SBEE : le solde impayé est RÉELLEMENT réglé (utility_charges passe "payée"), le reste est rendu', async () => {
  const chargeId = await insertCharge({ utilityType: 'sbee', amount: 6000 });
  const conn = await pool.getConnection();
  let leaseDepositId;
  try {
    await conn.beginTransaction();
    await recordAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
      enabledTenantRow: { deposit_sbee_enabled: 1 },
      entries: { sbee: { amount: 15000, paymentMethod: 'especes', paidAt: '2026-08-01' } },
    });
    const { deposits, peintureOverflow } = await finalizeAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      moveOutDate: '2026-09-28',
      refundMethods: { sbee: 'mobile_money' },
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
    });
    await conn.commit();
    assert.equal(peintureOverflow, 0);
    const sbee = deposits.find((d) => d.type === 'sbee');
    assert.deepEqual(sbee, { type: 'sbee', amount: 15000, deduction: 6000, returned: 9000, method: 'mobile_money' });
  } finally {
    conn.release();
  }

  const [[charge]] = await pool.query('SELECT status FROM utility_charges WHERE id = :id', { id: chargeId });
  assert.equal(charge.status, 'payee', 'la facture SBEE ne doit plus apparaître impayée après la sortie');
  const [[deposit]] = await pool.query("SELECT status, deduction_amount, returned_amount FROM lease_deposits WHERE lease_id = :l AND type = 'sbee'", { l: fx.leaseId });
  assert.equal(deposit.status, 'returned');
  assert.equal(Number(deposit.deduction_amount), 6000);
  assert.equal(Number(deposit.returned_amount), 9000);
  const [[entry]] = await pool.query(
    `SELECT el.amount FROM gl_entries e JOIN gl_entry_lines el ON el.entry_id = e.id AND el.side = 'debit'
     WHERE e.tenant_id = :t AND e.source_operation_type = 'caution_supplementaire_restituee'`,
    { t: fx.tenantId },
  );
  assert.equal(Number(entry.amount), 9000, 'seule la part RENDUE génère une écriture, jamais la part retenue');
});

test("finalizeAdditionalDeposits — SBEE : un impayé supérieur à la caution l'absorbe entièrement, rien à rendre, le solde restant reste dû (jamais effacé)", async () => {
  await insertCharge({ utilityType: 'sbee', amount: 50000 });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await recordAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
      enabledTenantRow: { deposit_sbee_enabled: 1 },
      entries: { sbee: { amount: 15000, paymentMethod: 'especes', paidAt: '2026-08-01' } },
    });
    const { deposits } = await finalizeAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      moveOutDate: '2026-09-28',
      refundMethods: {},
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
    });
    await conn.commit();
    const sbee = deposits.find((d) => d.type === 'sbee');
    assert.deepEqual(sbee, { type: 'sbee', amount: 15000, deduction: 15000, returned: 0, method: null });
  } finally {
    conn.release();
  }
  assert.equal(await getUnpaidUtilityBalance(pool, fx.tenantId, fx.leaseId, 'sbee'), 35000, 'le reliquat non couvert par la caution reste dû');
});

test('finalizeAdditionalDeposits — restitution SBEE/SONEB sans mode de règlement indiqué : refusé AVANT toute écriture (aucune caution partiellement traitée)', async () => {
  await pool.query('DELETE FROM utility_charges WHERE tenant_id = :t', { t: fx.tenantId }); // aucun impayé -> tout doit être rendu
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await recordAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
      enabledTenantRow: { deposit_sbee_enabled: 1, deposit_soneb_enabled: 1 },
      entries: {
        sbee: { amount: 15000, paymentMethod: 'especes', paidAt: '2026-08-01' },
        soneb: { amount: 10000, paymentMethod: 'especes', paidAt: '2026-08-01' },
      },
    });
    await assert.rejects(
      finalizeAdditionalDeposits(conn, {
        tenantId: fx.tenantId,
        leaseId: fx.leaseId,
        moveOutDate: '2026-09-28',
        refundMethods: { sbee: 'especes' }, // soneb manquant
        renterName: RENTER_NAME,
        createdBy: fx.dgId,
      }),
      /soneb|SONEB/i,
    );
    await conn.rollback();
  } finally {
    conn.release();
  }
  const [rows] = await pool.query("SELECT type, status FROM lease_deposits WHERE lease_id = :l", { l: fx.leaseId });
  assert.ok(rows.every((r) => r.status === 'held'), 'aucune caution ne doit être marquée restituée après un refus');
});

test('finalizeAdditionalDeposits — peinture : retenue plafonnée à la caution, le dépassement est renvoyé pour la caution de LOYER', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await recordAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
      enabledTenantRow: { deposit_peinture_enabled: 1 },
      entries: { peinture: { amount: 8000, paymentMethod: 'especes', paidAt: '2026-08-01' } },
    });
    const { deposits, peintureOverflow } = await finalizeAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      moveOutDate: '2026-09-28',
      peintureDeductionAmount: 12000, // dépasse la caution de 8000
      peintureDeductionNote: 'Salon entièrement à refaire',
      refundMethods: {},
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
    });
    await conn.commit();
    assert.equal(peintureOverflow, 4000, 'le dépassement (12000 - 8000) doit être signalé au bail — jamais absorbé silencieusement');
    const peinture = deposits.find((d) => d.type === 'peinture');
    assert.deepEqual(peinture, { type: 'peinture', amount: 8000, deduction: 8000, returned: 0, method: null });
  } finally {
    conn.release();
  }
  const [[deposit]] = await pool.query("SELECT deduction_note FROM lease_deposits WHERE lease_id = :l AND type = 'peinture'", { l: fx.leaseId });
  assert.equal(deposit.deduction_note, 'Salon entièrement à refaire');
});

test("finalizeAdditionalDeposits — peinture : retenue inférieure à la caution, le reste est rendu, aucun dépassement", async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await recordAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
      enabledTenantRow: { deposit_peinture_enabled: 1 },
      entries: { peinture: { amount: 10000, paymentMethod: 'especes', paidAt: '2026-08-01' } },
    });
    const { deposits, peintureOverflow } = await finalizeAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      moveOutDate: '2026-09-28',
      peintureDeductionAmount: 3000,
      refundMethods: { peinture: 'virement' },
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
    });
    await conn.commit();
    assert.equal(peintureOverflow, 0);
    assert.deepEqual(deposits.find((d) => d.type === 'peinture'), { type: 'peinture', amount: 10000, deduction: 3000, returned: 7000, method: 'virement' });
  } finally {
    conn.release();
  }
});

test('finalizeAdditionalDeposits — un bail sans aucune caution supplémentaire ne produit rien (jamais une erreur)', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const res = await finalizeAdditionalDeposits(conn, {
      tenantId: fx.tenantId,
      leaseId: fx.leaseId,
      moveOutDate: '2026-09-28',
      refundMethods: {},
      renterName: RENTER_NAME,
      createdBy: fx.dgId,
    });
    await conn.commit();
    assert.deepEqual(res, { deposits: [], peintureOverflow: 0 });
  } finally {
    conn.release();
  }
});

test("rattrapage GL (backfill) — réception ET restitution d'une même caution génèrent chacune leur écriture, aucune ignorée par un identifiant partagé", async () => {
  // Simule une caution intégralement vécue (reçue puis restituée) AVANT toute activation de la
  // comptabilité avancée — reproduit exactement le piège corrigé : `caution_supplementaire_recue` et
  // `_restituee` partagent le même id de ligne ; sans le second label (`lease_deposits_return`), la
  // restitution serait ignorée à tort comme "déjà faite" dès que la réception est rattrapée.
  const [row] = await pool.query(
    `INSERT INTO lease_deposits (tenant_id, lease_id, type, amount, status, received_at, received_method,
       returned_at, returned_amount, returned_method, deduction_amount, created_by)
     VALUES (:t, :l, 'peinture', 9000, 'returned', '2026-01-05', 'especes', '2026-02-10', 6000, 'virement', 3000, :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );

  const summary = await backfillHistoricalEntries(pool, fx.tenantId, { fromDate: '2026-01-01', createdBy: fx.dgId });
  assert.equal(summary.errors.length, 0, JSON.stringify(summary.errors));

  const [entries] = await pool.query(
    `SELECT e.source_operation_type, e.source_table, el.amount
     FROM gl_entries e JOIN gl_entry_lines el ON el.entry_id = e.id AND el.side = 'debit'
     WHERE e.tenant_id = :t AND e.source_id = :id ORDER BY e.source_operation_type`,
    { t: fx.tenantId, id: row.insertId },
  );
  assert.deepEqual(
    entries.map((e) => [e.source_operation_type, e.source_table, Number(e.amount)]),
    [
      ['caution_supplementaire_recue', 'lease_deposits', 9000],
      ['caution_supplementaire_restituee', 'lease_deposits_return', 6000],
    ],
  );

  // Rejouer le rattrapage ne doit jamais dupliquer (idempotent).
  const again = await backfillHistoricalEntries(pool, fx.tenantId, { fromDate: '2026-01-01', createdBy: fx.dgId });
  assert.equal(again.generated, 0);
  assert.equal(again.skipped, 2);
});
