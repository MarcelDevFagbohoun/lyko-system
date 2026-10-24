'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { computeMandantsCabinetIndicator } = require('../../src/services/gl/glMandantsCabinetService');
const { createFixture, teardown } = require('./fixtures');

let fx;
before(async () => {
  fx = await createFixture();
});
after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

async function post(operationType, amount, date = '2026-05-10') {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await genererEcriture(conn, {
      tenantId: fx.tenantId, operationType, entryDate: date, amount, paymentMethod: 'especes',
      narrationVars: { fluide: 'Eau', periode: '2026-05', locataire: 'L', proprietaire: 'P' }, createdBy: fx.dgId,
      context: { leaseId: fx.leaseId, ownerId: fx.ownerId },
    });
    await conn.commit();
    return r;
  } finally {
    conn.release();
  }
}
async function bal(code) {
  const [[r]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side='credit' THEN el.amount ELSE -el.amount END),0) s
       FROM gl_entry_lines el JOIN gl_entries e ON e.id=el.entry_id JOIN gl_accounts a ON a.id=el.account_id
      WHERE e.tenant_id=:t AND a.code=:c`,
    { t: fx.tenantId, c: code },
  );
  return Number(r.s);
}

test('mode clients (défaut) : crédit du 411, 4672 intact', async () => {
  await post('charge_locative_encaissee', 4000);
  assert.equal(await bal('411'), 4000);
  assert.equal(await bal('4672'), 0);
});

test('mode propriétaire : crédit du 4672, 411 inchangé', async () => {
  await pool.query("UPDATE tenants SET gl_utility_account_mode = 'proprietaire' WHERE id = :t", { t: fx.tenantId });
  await post('charge_locative_encaissee', 6000);
  assert.equal(await bal('411'), 4000);
  assert.equal(await bal('4672'), 6000);
  const ind = await computeMandantsCabinetIndicator(pool, fx.tenantId);
  assert.equal(ind.chargesHeld, 6000);
});

test('crédit du solde propriétaire : 4672 d\'abord puis reliquat sur 411, écritures équilibrées', async () => {
  const r = await post('charge_ajoutee_solde_proprietaire', 10000);
  assert.equal(r.totalDebit, r.totalCredit);
  assert.equal(await bal('4672'), 0);
  assert.equal(await bal('411'), 0);
  assert.equal(await bal('4671'), 10000);
});

test('charge réglée par la caution suit aussi le mode', async () => {
  await post('caution_recue', 20000);
  await post('charge_locative_reglee_par_caution', 3000);
  assert.equal(await bal('4672'), 3000);
  assert.equal(await bal('411'), 0);
});
