'use strict';

/**
 * Dette existante à l'entrée d'un locataire (onboarding d'une entreprise
 * avec des locataires déjà en place) — voir migration 055 et la discussion
 * documentée dans routes/leases.js (`POST /:leaseId/opening-debt/payments`)
 * et services/rentTracking.js (`listPortfolioArrears`/`snapshotLeaseBalances`).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { listPortfolioArrears, snapshotLeaseBalances } = require('../../src/services/rentTracking');
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

test("genererEcriture — dette_initiale_encaissee : MÊME répartition qu'un loyer normal (commission 10% + reste au propriétaire)", async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'dette_initiale_encaissee',
      entryDate: '2026-02-01',
      amount: 100000,
      paymentMethod: 'especes',
      narrationVars: { locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 100000);
    assert.equal(result.totalCredit, 100000);
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
    assert.equal(Number(lines[0].amount), 100000);
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '706');
    assert.equal(Number(lines[1].amount), 10000, '10% de commission, comme loyer_encaisse');
    assert.equal(lines[2].side, 'credit');
    assert.equal(lines[2].code, '4671');
    assert.equal(lines[2].display_name, 'Propriétaire Test');
    assert.equal(Number(lines[2].amount), 90000);
  } finally {
    conn.release();
  }
});

test("genererEcriture — dette_initiale_encaissee respecte gl_commission_timing='reversement' (aucune commission ici)", async () => {
  await pool.query("UPDATE tenants SET gl_commission_timing = 'reversement' WHERE id = :t", { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'dette_initiale_encaissee',
      entryDate: '2026-02-02',
      amount: 60000,
      paymentMethod: 'virement',
      narrationVars: { locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    assert.equal(result.lines.length, 2, 'aucune ligne 706 : la commission est reportée au reversement');
    const ownerLine = result.lines.find((l) => l.side === 'credit');
    assert.equal(ownerLine.amount, 60000, 'le propriétaire reçoit le montant plein pour cette écriture');
  } finally {
    conn.release();
    await pool.query("UPDATE tenants SET gl_commission_timing = 'encaissement' WHERE id = :t", { t: fx.tenantId });
  }
});

test('listPortfolioArrears — inclut le reliquat de dette initiale, réduit après un règlement partiel', async () => {
  // Delta : le bail de fixture accumule déjà du retard de loyer réel au fil
  // des exécutions successives de la suite (aucun paiement enregistré) —
  // on isole l'effet de la dette initiale en comparant avant/après, jamais
  // en supposant un montant absolu.
  const before1 = await listPortfolioArrears(fx.tenantId);
  const baseline = before1.find((r) => r.leaseId === fx.leaseId);
  const baselineOwed = baseline ? baseline.amountOwed : 0;

  await pool.query('UPDATE leases SET opening_debt_amount = 30000 WHERE id = :id', { id: fx.leaseId });
  const afterDebt = await listPortfolioArrears(fx.tenantId);
  const withDebt = afterDebt.find((r) => r.leaseId === fx.leaseId);
  assert.ok(withDebt, 'le bail doit apparaître même si ce n\'est QUE la dette initiale qui est due');
  assert.equal(withDebt.openingDebtRemaining, 30000);
  assert.equal(withDebt.amountOwed, baselineOwed + 30000);

  await pool.query(
    `INSERT INTO lease_opening_debt_payments (tenant_id, lease_id, amount, payment_method, paid_at, recorded_by)
     VALUES (:tenantId, :leaseId, 20000, 'especes', '2026-02-03', :by)`,
    { tenantId: fx.tenantId, leaseId: fx.leaseId, by: fx.dgId },
  );
  const afterPartial = await listPortfolioArrears(fx.tenantId);
  const partial = afterPartial.find((r) => r.leaseId === fx.leaseId);
  assert.equal(partial.openingDebtRemaining, 10000, '30000 déclarés - 20000 réglés');
  assert.equal(partial.amountOwed, baselineOwed + 10000);
});

test('snapshotLeaseBalances — fige le solde (loyer en retard + dette initiale) dans lease_balance_snapshots', async () => {
  const [[current]] = await pool.query(
    'SELECT COALESCE(SUM(amount),0) AS paid FROM lease_opening_debt_payments WHERE lease_id = :id',
    { id: fx.leaseId },
  );
  const remainingBefore = 30000 - Number(current.paid); // suite du test précédent : 10000 restants

  const period = '2026-09';
  await snapshotLeaseBalances(fx.tenantId, period);

  const [rows] = await pool.query(
    'SELECT amount_due FROM lease_balance_snapshots WHERE tenant_id = :t AND period = :p AND lease_id = :l',
    { t: fx.tenantId, p: period, l: fx.leaseId },
  );
  assert.equal(rows.length, 1, 'une seule ligne de snapshot pour ce bail sur ce mois');
  assert.ok(Number(rows[0].amount_due) >= remainingBefore, 'inclut au moins le reliquat de dette initiale restant');

  // Rejouer sur le même mois ne doit jamais dupliquer (contrainte UNIQUE) —
  // vérifie que la fonction ne plante pas si jamais rappelée par erreur.
  await assert.rejects(() => snapshotLeaseBalances(fx.tenantId, period));
});
