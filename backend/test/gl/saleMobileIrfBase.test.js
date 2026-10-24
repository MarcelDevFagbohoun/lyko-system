'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const seed = require('../../src/db/seedGeneralLedger');
const { computeMandantsCabinetIndicator } = require('../../src/services/gl/glMandantsCabinetService');
const { createFixture, setCommissionRate, teardown } = require('./fixtures');

let fx;
before(async () => {
  fx = await createFixture();
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10);
});
after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

async function linesOf(entryId) {
  const [lines] = await pool.query(
    'SELECT el.side, el.amount, a.code, el.payment_method FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
    { id: entryId },
  );
  return lines.map((l) => [l.side, l.code, Number(l.amount)]);
}

async function dispose(price, assetLabel = 'PC') {
  const [asset] = await pool.query(
    `INSERT INTO fixed_assets (tenant_id, label, category, acquisition_date, acquisition_cost, useful_life_years, payment_status, payment_method, created_by)
     VALUES (:t, :l, 'informatique', '2025-01-01', 600000, 3, 'paid', 'virement', :by)`,
    { t: fx.tenantId, l: assetLabel, by: fx.dgId },
  );
  await pool.query('INSERT INTO fixed_asset_depreciations (tenant_id, fixed_asset_id, period, amount, recorded_by) VALUES (:t, :aid, :p, 100000, :by)', {
    t: fx.tenantId, aid: asset.insertId, p: '2026-01', by: fx.dgId,
  });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await genererEcriture(conn, {
      tenantId: fx.tenantId, operationType: price > 0 ? 'cession_informatique' : 'sortie_informatique', entryDate: '2026-04-01',
      amount: 600000, paymentMethod: price > 0 ? 'virement' : undefined, narrationVars: { libelle: 'x' },
      sourceTable: 'fixed_asset_disposals', sourceId: asset.insertId, createdBy: fx.dgId, context: { fixedAssetId: asset.insertId, salePrice: price },
    });
    await conn.commit();
    return r;
  } finally {
    conn.release();
  }
}

test('cession avec prix : trésorerie débitée, 754 crédité, plus-value = 754 - 654', async () => {
  const r = await dispose(520000);
  assert.deepEqual(await linesOf(r.entryId), [
    ['debit', '28442', 100000],
    ['debit', '654', 500000],
    ['debit', '521', 520000],
    ['credit', '2442', 600000],
    ['credit', '754', 520000],
  ]);
  assert.equal(r.totalDebit, r.totalCredit);
});

test('cession à prix inférieur à la VNC (moins-value) et sans prix : écritures équilibrées', async () => {
  const loss = await dispose(300000, 'PC2');
  assert.equal(loss.totalDebit, loss.totalCredit);
  const free = await dispose(0, 'PC3'); // sortie sans contrepartie : règle historique
  assert.deepEqual(await linesOf(free.entryId), [['debit', '28442', 100000], ['debit', '654', 500000], ['credit', '2442', 600000]]);
});

test('Mobile Money renommable : les écritures suivent le compte renommé, sans le recréer', async () => {
  const [[acc]] = await pool.query("SELECT code, system_key FROM gl_accounts WHERE tenant_id = :t AND code = '552'", { t: fx.tenantId });
  assert.equal(acc.system_key, 'mobile_money_account');
  await pool.query("UPDATE gl_accounts SET code = '585' WHERE tenant_id = :t AND system_key = 'mobile_money_account'", { t: fx.tenantId });

  const added = await seed.syncMissingAccounts(fx.tenantId);
  assert.ok(!added.added.includes('552'), 'le compte renommé ne doit pas être recréé');

  const r = await genererEcriture(pool, {
    tenantId: fx.tenantId, operationType: 'depense_autre', entryDate: '2026-05-02', amount: 1000, paymentMethod: 'mobile_money',
    narrationVars: { libelle: 'momo' }, createdBy: fx.dgId,
  });
  const lines = await linesOf(r.entryId);
  assert.ok(lines.some((l) => l[1] === '585'));
  const ind = await computeMandantsCabinetIndicator(pool, fx.tenantId);
  assert.equal(ind.treasury.mobileMoney, -1000);
});

async function reversement(amount, date) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await genererEcriture(conn, {
      tenantId: fx.tenantId, operationType: 'reversement_proprietaire', entryDate: date, amount, paymentMethod: 'virement',
      narrationVars: { proprietaire: 'P' }, createdBy: fx.dgId, context: { ownerId: fx.ownerId },
    });
    await conn.commit();
    return r;
  } finally {
    conn.release();
  }
}

test('IRF : base « versement » (défaut) puis « loyer brut » (versement reconstitué avant commission 10 %)', async () => {
  await pool.query("UPDATE tenants SET gl_irf_enabled = 1, gl_irf_rate = 10 WHERE id = :t", { t: fx.tenantId });
  const a = await reversement(90000, '2026-06-01');
  assert.deepEqual((await linesOf(a.entryId)).find((l) => l[1] === '442'), ['credit', '442', 9000]);

  await pool.query("UPDATE tenants SET gl_irf_base = 'loyer_brut' WHERE id = :t", { t: fx.tenantId });
  const b = await reversement(90000, '2026-06-02'); // brut = 100000 -> IRF 10000
  assert.deepEqual((await linesOf(b.entryId)).find((l) => l[1] === '442'), ['credit', '442', 10000]);
  assert.equal(b.totalDebit, b.totalCredit);
});

test('IRF « loyer brut » avec commission au reversement : le versement est déjà le brut', async () => {
  await pool.query("UPDATE tenants SET gl_commission_timing = 'reversement' WHERE id = :t", { t: fx.tenantId });
  const c = await reversement(100000, '2026-06-03');
  assert.deepEqual((await linesOf(c.entryId)).find((l) => l[1] === '442'), ['credit', '442', 10000]);
  assert.equal(c.totalDebit, c.totalCredit);
});
