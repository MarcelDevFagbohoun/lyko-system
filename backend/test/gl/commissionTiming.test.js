'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
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

test("réglage 'reversement' : loyer_encaisse ne prélève PLUS la commission — le propriétaire reçoit le montant plein", async () => {
  await pool.query("UPDATE tenants SET gl_commission_timing = 'reversement' WHERE id = :t", { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'loyer_encaisse',
      entryDate: '2026-01-05',
      amount: 100000,
      paymentMethod: 'virement',
      narrationVars: { mois: '2026-01', locataire: 'Locataire Test' },
      createdBy: fx.dgId,
      context: { leaseId: fx.leaseId },
    });
    await conn.commit();

    assert.equal(result.lines.length, 2, 'aucune ligne 706 : la commission de 10% ne s\'applique plus ici');
    const ownerLine = result.lines.find((l) => l.side === 'credit');
    assert.equal(ownerLine.amount, 100000, 'le propriétaire est crédité du montant BRUT, rien retenu');
  } finally {
    conn.release();
    await pool.query("UPDATE tenants SET gl_commission_timing = 'encaissement' WHERE id = :t", { t: fx.tenantId });
  }
});

test("réglage 'reversement' : reversement_proprietaire prélève la commission à ce moment-là (706 + trésorerie nette)", async () => {
  await pool.query("UPDATE tenants SET gl_commission_timing = 'reversement' WHERE id = :t", { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'reversement_proprietaire',
      entryDate: '2026-01-20',
      amount: 100000,
      paymentMethod: 'virement',
      narrationVars: { proprietaire: 'Propriétaire Test' },
      createdBy: fx.dgId,
      context: { ownerId: fx.ownerId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 100000);
    assert.equal(result.totalCredit, 100000);
    assert.equal(result.lines.length, 3, 'tiers-propriétaire (débit) + 706 commission + trésorerie nette');

    const [lines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '4671');
    assert.equal(Number(lines[0].amount), 100000);
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '706');
    assert.equal(Number(lines[1].amount), 10000, '10% de 100000 prélevés ICI, au reversement');
    assert.equal(lines[2].side, 'credit');
    assert.equal(lines[2].code, '521'); // virement -> banque
    assert.equal(Number(lines[2].amount), 90000, 'trésorerie sortante nette de commission');
  } finally {
    conn.release();
    await pool.query("UPDATE tenants SET gl_commission_timing = 'encaissement' WHERE id = :t", { t: fx.tenantId });
  }
});

test("réglage par défaut ('encaissement') : reversement_proprietaire ne prélève AUCUNE commission (déjà prélevée à l'encaissement)", async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'reversement_proprietaire',
      entryDate: '2026-01-25',
      amount: 45000,
      paymentMethod: 'especes',
      narrationVars: { proprietaire: 'Propriétaire Test' },
      createdBy: fx.dgId,
      context: { ownerId: fx.ownerId },
    });
    await conn.commit();

    assert.equal(result.lines.length, 2, 'la ligne 706 (0 au réglage par défaut) doit être omise');
    const treasuryLine = result.lines.find((l) => l.side === 'credit');
    assert.equal(treasuryLine.amount, 45000, 'montant intégral versé, comportement historique inchangé');
  } finally {
    conn.release();
  }
});
