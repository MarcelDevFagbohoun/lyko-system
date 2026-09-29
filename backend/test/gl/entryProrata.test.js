'use strict';

/**
 * Prorata d'entrée (étape 42, migration 067) — un locataire qui entre en cours de mois règle, à la
 * signature, les jours occupés avant la première échéance normale (voir `services/rentTracking.js`
 * `computeEntryProrata`, diviseur forfaitaire de 30 jours). DÉCISION EXPLICITE DE L'UTILISATEUR : le
 * montant appartient au propriétaire — MÊME répartition qu'un loyer normal (comme
 * `dette_initiale_encaissee`, voir test/gl/openingDebt.test.js), jamais comme les frais d'agence
 * (100 % cabinet, voir test/gl/entryFee.test.js).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { getEscrowBalances } = require('../../src/services/commission');
const { computeEntryProrata, firstRegularDueDate } = require('../../src/services/rentTracking');
const { createFixture, setCommissionRate, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10); // 10 %
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test("genererEcriture — prorata_entree_encaisse : MÊME répartition qu'un loyer normal (commission 10% + reste au propriétaire)", async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'prorata_entree_encaisse',
      entryDate: '2026-09-28',
      amount: 20000,
      paymentMethod: 'especes',
      narrationVars: { locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 20000);
    assert.equal(result.totalCredit, 20000);
    assert.equal(result.lines.length, 3);

    const [lines] = await pool.query(
      `SELECT el.side, el.amount, a.code, tp.display_name
       FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id
       LEFT JOIN gl_third_parties tp ON tp.id = el.third_party_id
       WHERE el.entry_id = :id ORDER BY el.line_order`,
      { id: result.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '571'); // trésorerie espèces
    assert.equal(Number(lines[0].amount), 20000);
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '706');
    assert.equal(Number(lines[1].amount), 2000, '10% de commission, comme loyer_encaisse/dette_initiale_encaissee');
    assert.equal(lines[2].side, 'credit');
    assert.equal(lines[2].code, '4671');
    assert.equal(lines[2].display_name, 'Propriétaire Test');
    assert.equal(Number(lines[2].amount), 18000);
  } finally {
    conn.release();
  }
});

test("genererEcriture — prorata_entree_encaisse respecte gl_commission_timing='reversement' (aucune commission ici)", async () => {
  await pool.query("UPDATE tenants SET gl_commission_timing = 'reversement' WHERE id = :t", { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'prorata_entree_encaisse',
      entryDate: '2026-09-29',
      amount: 12000,
      paymentMethod: 'virement',
      narrationVars: { locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    assert.equal(result.lines.length, 2, 'aucune ligne 706 : la commission est reportée au reversement');
    const ownerLine = result.lines.find((l) => l.side === 'credit');
    assert.equal(ownerLine.amount, 12000, 'le propriétaire reçoit le montant plein pour cette écriture');
  } finally {
    conn.release();
    await pool.query("UPDATE tenants SET gl_commission_timing = 'encaissement' WHERE id = :t", { t: fx.tenantId });
  }
});

test("getEscrowBalances — un prorata reçu s'ajoute au compte séquestre du propriétaire, commission déduite", async () => {
  const before1 = await getEscrowBalances(fx.tenantId);
  const baseline = before1.get(fx.ownerId)?.balance ?? 0;

  await pool.query(
    `UPDATE leases SET entry_proration = 'prorata', entry_prorata_amount = 20000, entry_prorata_days = 10,
            entry_prorata_due_date = '2026-10-05', entry_prorata_received_at = '2026-09-28',
            entry_prorata_received_method = 'especes'
     WHERE id = :id`,
    { id: fx.leaseId },
  );

  const after1 = await getEscrowBalances(fx.tenantId);
  const b = after1.get(fx.ownerId);
  assert.equal(b.balance, baseline + 18000, '20 000 × 90 % (commission 10 %) = 18 000 de plus');
  assert.equal(b.breakdown.prorata, 20000, 'le détail expose le montant BRUT, avant commission');
});

test('computeEntryProrata / firstRegularDueDate — cohérent avec ce que la route de création de bail écrirait', () => {
  // Même scénario que le test escrow ci-dessus : entrée le 28 septembre, échéance le 5 → 7 jours.
  const due = firstRegularDueDate('2026-09-28', 5);
  assert.equal(due, '2026-10-05');
  const r = computeEntryProrata({ startDate: '2026-09-28', monthlyRent: 50000, rentDueDay: 5 });
  assert.deepEqual(r, { days: 7, amount: 11667, dueDate: '2026-10-05' });
});
