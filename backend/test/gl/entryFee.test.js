'use strict';

/**
 * Frais d'agence pris DIRECTEMENT au locataire à la signature du bail
 * (`leases.entry_fee_amount`, migration 058) — demande explicite de
 * l'utilisateur : « ça devient directement celui de l'entreprise, jamais
 * comptabilisé dans la recette du propriétaire ». Contrairement à
 * `dette_initiale_encaissee` (même répartition qu'un loyer normal), cette
 * écriture ne doit JAMAIS se répartir — 100 % en 706, aucun tiers
 * propriétaire, quel que soit le taux de commission ou son mode de
 * comptabilisation.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { getEscrowBalances } = require('../../src/services/commission');
const { createFixture, setCommissionRate, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10); // 10 % — pour vérifier qu'elle n'a AUCUN effet ici.
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test("genererEcriture — frais_agence_encaisse : 100% en 706, aucun tiers propriétaire", async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'frais_agence_encaisse',
      entryDate: '2026-02-01',
      amount: 25000,
      paymentMethod: 'mobile_money',
      narrationVars: { locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: {},
    });
    await conn.commit();

    assert.equal(result.totalDebit, 25000);
    assert.equal(result.totalCredit, 25000);
    assert.equal(result.lines.length, 2, 'trésorerie + 706 uniquement, jamais de ligne tiers_proprietaire');

    const [lines] = await pool.query(
      `SELECT el.side, el.amount, el.third_party_id, a.code
       FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id
       WHERE el.entry_id = :id ORDER BY el.line_order`,
      { id: result.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '552'); // trésorerie mobile money
    assert.equal(Number(lines[0].amount), 25000);
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '706');
    assert.equal(Number(lines[1].amount), 25000, 'montant intégral, aucune retenue');
    assert.equal(lines[1].third_party_id, null, 'jamais de tiers — ni locataire ni propriétaire');
  } finally {
    conn.release();
  }
});

test("genererEcriture — frais_agence_encaisse ignore gl_commission_timing='reversement' (toujours 100% immédiat)", async () => {
  await pool.query("UPDATE tenants SET gl_commission_timing = 'reversement' WHERE id = :t", { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'frais_agence_encaisse',
      entryDate: '2026-02-02',
      amount: 15000,
      paymentMethod: 'especes',
      narrationVars: { locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: {},
    });
    await conn.commit();

    assert.equal(result.lines.length, 2);
    assert.equal(result.lines.find((l) => l.side === 'credit').amount, 15000);
  } finally {
    conn.release();
    await pool.query("UPDATE tenants SET gl_commission_timing = 'encaissement' WHERE id = :t", { t: fx.tenantId });
  }
});

test('getEscrowBalances — jamais affecté par entry_fee_amount (recette du propriétaire intacte)', async () => {
  const before1 = await getEscrowBalances(fx.tenantId);
  const baselineBalance = before1.get(fx.ownerId)?.balance ?? 0;

  await pool.query('UPDATE leases SET entry_fee_amount = 100000, entry_fee_received_at = :d WHERE id = :id', {
    d: '2026-02-01',
    id: fx.leaseId,
  });

  const after1 = await getEscrowBalances(fx.tenantId);
  const balanceAfter = after1.get(fx.ownerId)?.balance ?? 0;
  assert.equal(balanceAfter, baselineBalance, "les frais d'agence ne doivent jamais entrer dans la recette du propriétaire");
});
