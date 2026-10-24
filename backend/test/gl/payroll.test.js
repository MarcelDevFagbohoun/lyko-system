'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { computePayroll, computeProgressiveTax, loadPayrollSettings } = require('../../src/services/payroll');
const { getPayrollLiabilities, payLiability } = require('../../src/services/gl/glLiabilityService');
const { createFixture, teardown } = require('./fixtures');

let fx;
before(async () => {
  fx = await createFixture();
});
after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

const BRACKETS = [
  { upTo: 60000, rate: 0 },
  { upTo: 150000, rate: 10 },
  { upTo: 250000, rate: 15 },
  { upTo: null, rate: 30 },
];

test('barème progressif par tranches', () => {
  assert.equal(computeProgressiveTax(50000, BRACKETS), 0);
  assert.equal(computeProgressiveTax(100000, BRACKETS), 4000);
  assert.equal(computeProgressiveTax(200000, BRACKETS), 9000 + 7500);
  assert.equal(computeProgressiveTax(300000, BRACKETS), 9000 + 15000 + 15000);
  assert.equal(computeProgressiveTax(100000, []), 0);
});

test('niveau net : aucun prélèvement, net = brut - retenue', () => {
  const p = computePayroll({ level: 'net', cnssEmployeeRate: 3.6, cnssEmployerRate: 15.4, itsBrackets: BRACKETS }, { gross: 200000, deduction: 10000 });
  assert.deepEqual([p.cnssEmployee, p.cnssEmployer, p.its, p.net], [0, 0, 0, 190000]);
});

test('niveau complet : CNSS + ITS sur base brut - CNSS salariale', () => {
  const p = computePayroll({ level: 'complet', cnssEmployeeRate: 3.6, cnssEmployerRate: 15.4, itsBrackets: BRACKETS }, { gross: 200000, deduction: 0 });
  assert.equal(p.cnssEmployee, 7200);
  assert.equal(p.cnssEmployer, 30800);
  assert.equal(p.taxableBase, 192800);
  assert.equal(p.its, computeProgressiveTax(192800, BRACKETS));
  assert.equal(p.net, 200000 - 7200 - p.its);
});

test('écriture de paie détaillée : équilibrée, 431/447/664 renseignés, règlements bornés au dû', async () => {
  await pool.query(
    "UPDATE tenants SET gl_payroll_level = 'complet', gl_its_brackets = :b WHERE id = :t",
    { b: JSON.stringify(BRACKETS), t: fx.tenantId },
  );
  const settings = await loadPayrollSettings(pool, fx.tenantId);
  assert.equal(settings.level, 'complet');
  const payroll = computePayroll(settings, { gross: 200000, deduction: 20000 });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await genererEcriture(conn, {
      tenantId: fx.tenantId, operationType: 'salaire_paye_detaille', entryDate: '2026-06-30', amount: payroll.net,
      paymentMethod: 'virement', narrationVars: { mois: '2026-06', employe: 'E' }, createdBy: fx.dgId, context: { payroll },
    });
    await conn.commit();
    assert.equal(r.totalDebit, r.totalCredit);
  } finally {
    conn.release();
  }
  const dues = await getPayrollLiabilities(pool, fx.tenantId);
  assert.equal(dues.cnss, payroll.cnssEmployee + payroll.cnssEmployer);
  assert.equal(dues.its, payroll.its);

  await payLiability(pool, fx.tenantId, 'cnss', { amount: dues.cnss, paymentMethod: 'virement', paidAt: '2026-07-10', userId: fx.dgId });
  assert.equal((await getPayrollLiabilities(pool, fx.tenantId)).cnss, 0);
  await assert.rejects(() => payLiability(pool, fx.tenantId, 'cnss', { amount: 1, paymentMethod: 'virement', paidAt: '2026-07-11', userId: fx.dgId }), /Rien à reverser/);
  await assert.rejects(() => payLiability(pool, fx.tenantId, 'its', { amount: dues.its + 1, paymentMethod: 'virement', paidAt: '2026-07-11', userId: fx.dgId }), /dépasse/);
});
