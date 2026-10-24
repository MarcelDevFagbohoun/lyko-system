'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { splitVat, getVatBalance, getVatReport, payVat } = require('../../src/services/gl/glVat');
const { extourneEcriture } = require('../../src/services/gl/glReversalService');
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

async function rent(amount, date = '2026-02-05') {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await genererEcriture(conn, {
      tenantId: fx.tenantId, operationType: 'loyer_encaisse', entryDate: date, amount, paymentMethod: 'especes',
      narrationVars: { locataire: 'L', mois: '2026-02' }, createdBy: fx.dgId, context: { leaseId: fx.leaseId, ownerId: fx.ownerId },
    });
    await conn.commit();
    return r;
  } finally {
    conn.release();
  }
}

async function codeOf(accountId) {
  const [[r]] = await pool.query('SELECT code FROM gl_accounts WHERE id = :id', { id: accountId });
  return r.code;
}

test('splitVat : somme exacte, arrondi sur la TVA', () => {
  assert.deepEqual(splitVat(5000, 18), { ht: 4237, tva: 763 });
  for (const ttc of [1, 7, 999, 50000, 123457]) {
    const { ht, tva } = splitVat(ttc, 18);
    assert.equal(ht + tva, ttc);
  }
});

test('TVA désactivée (défaut) : aucune ligne 443, comportement historique', async () => {
  const r = await rent(50000);
  const codes = await Promise.all(r.lines.map((l) => codeOf(l.accountId)));
  assert.ok(!codes.includes('443'));
  const l706 = r.lines.find((l, i) => codes[i] === '706');
  assert.equal(l706.amount, 5000);
});

test('TVA 18 % : 706 en HT + 443, écriture équilibrée, propriétaire et trésorerie inchangés', async () => {
  await pool.query('UPDATE tenants SET gl_vat_enabled = 1, gl_vat_rate = 18 WHERE id = :t', { t: fx.tenantId });
  const r = await rent(50000, '2026-02-06');
  const byCode = {};
  for (const l of r.lines) byCode[await codeOf(l.accountId)] = l.amount;
  assert.equal(byCode['706'], 4237);
  assert.equal(byCode['443'], 763);
  assert.equal(byCode['4671'], 45000, 'le propriétaire touche la même part');
  assert.equal(byCode['571'] ?? byCode['5711'] ?? r.totalDebit, 50000);
  assert.equal(r.totalDebit, r.totalCredit);
});

test('solde TVA, rapport mensuel, règlement partiel puis refus de dépassement', async () => {
  const { balance } = await getVatBalance(pool, fx.tenantId);
  assert.equal(balance, 763);
  const report = await getVatReport(pool, fx.tenantId, { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(report, [{ month: '2026-02', baseHt: 4237, tva: 763, ttc: 5000 }]);

  await payVat(pool, fx.tenantId, { amount: 700, paymentMethod: 'especes', paidAt: '2026-03-01', userId: fx.dgId });
  assert.equal((await getVatBalance(pool, fx.tenantId)).balance, 63);
  await assert.rejects(() => payVat(pool, fx.tenantId, { amount: 100, paymentMethod: 'especes', paidAt: '2026-03-02', userId: fx.dgId }), /dépasse/);
});

test("extourne d'une écriture avec TVA : le 443 revient à l'équilibre", async () => {
  const before = (await getVatBalance(pool, fx.tenantId)).balance;
  const r = await rent(20000, '2026-02-10');
  assert.ok((await getVatBalance(pool, fx.tenantId)).balance > before);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await extourneEcriture(conn, { tenantId: fx.tenantId, entryId: r.entryId, entryDate: '2026-02-11', userId: fx.dgId, reason: 'test' });
    await conn.commit();
  } finally {
    conn.release();
  }
  assert.equal((await getVatBalance(pool, fx.tenantId)).balance, before);
});

test('commission prélevée au reversement : TVA aussi éclatée', async () => {
  await pool.query("UPDATE tenants SET gl_commission_timing = 'reversement' WHERE id = :t", { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await genererEcriture(conn, {
      tenantId: fx.tenantId, operationType: 'reversement_proprietaire', entryDate: '2026-03-10', amount: 100000,
      paymentMethod: 'virement', narrationVars: { proprietaire: 'P' }, createdBy: fx.dgId, context: { ownerId: fx.ownerId },
    });
    await conn.commit();
    const byCode = {};
    for (const l of r.lines) byCode[await codeOf(l.accountId)] = (byCode[await codeOf(l.accountId)] ?? 0) + l.amount;
    assert.equal(byCode['706'] + byCode['443'], 10000);
    assert.equal(byCode['443'], 1525);
    assert.equal(r.totalDebit, r.totalCredit);
  } finally {
    conn.release();
  }
});
