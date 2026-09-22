'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { getIrfBalance, payIrf } = require('../../src/services/gl/glIrfService');
const { createFixture, setCommissionRate, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('IRF désactivé (défaut) : reversement_proprietaire ne retient rien, comportement historique inchangé', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'reversement_proprietaire',
      entryDate: '2026-01-10',
      amount: 90000,
      paymentMethod: 'especes',
      narrationVars: { proprietaire: 'Propriétaire Test' },
      createdBy: fx.dgId,
      context: { ownerId: fx.ownerId },
    });
    await conn.commit();

    assert.equal(result.lines.length, 2, 'ni 706 ni 442 : les deux valent 0 et sont omises');
    const treasuryLine = result.lines.find((l) => l.side === 'credit');
    assert.equal(treasuryLine.amount, 90000);
  } finally {
    conn.release();
  }
});

test('IRF activé à 5 % : retenue sur le reversement, trésorerie nette, 442 crédité', async () => {
  await pool.query('UPDATE tenants SET gl_irf_enabled = 1, gl_irf_rate = 5 WHERE id = :t', { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'reversement_proprietaire',
      entryDate: '2026-01-15',
      amount: 100000,
      paymentMethod: 'virement',
      narrationVars: { proprietaire: 'Propriétaire Test' },
      createdBy: fx.dgId,
      context: { ownerId: fx.ownerId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 100000);
    assert.equal(result.totalCredit, 100000);

    const [lines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.equal(lines.length, 3, 'tiers-propriétaire (débit) + IRF (442) + trésorerie nette (pas de commission ici)');
    assert.equal(lines[0].code, '4671');
    assert.equal(Number(lines[0].amount), 100000);
    assert.equal(lines[1].code, '442');
    assert.equal(Number(lines[1].amount), 5000, '5% de 100000 retenus au titre de l\'IRF');
    assert.equal(lines[2].code, '521'); // virement -> banque
    assert.equal(Number(lines[2].amount), 95000, 'trésorerie sortante nette de la retenue IRF');
  } finally {
    conn.release();
    await pool.query('UPDATE tenants SET gl_irf_enabled = 0, gl_irf_rate = 0 WHERE id = :t', { t: fx.tenantId });
  }
});

test('IRF (5 %) + commission au reversement (10 %) simultanément : les 2 retenues se cumulent sans écart d\'arrondi', async () => {
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10);
  await pool.query(
    "UPDATE tenants SET gl_irf_enabled = 1, gl_irf_rate = 5, gl_commission_timing = 'reversement' WHERE id = :t",
    { t: fx.tenantId },
  );
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'reversement_proprietaire',
      entryDate: '2026-01-20',
      amount: 100000,
      paymentMethod: 'especes',
      narrationVars: { proprietaire: 'Propriétaire Test' },
      createdBy: fx.dgId,
      context: { ownerId: fx.ownerId },
    });
    await conn.commit();

    assert.equal(result.totalDebit, 100000);
    assert.equal(result.totalCredit, 100000, 'écriture équilibrée malgré les 2 retenues combinées');

    const [lines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: result.entryId },
    );
    assert.equal(lines.length, 4);
    assert.equal(lines[1].code, '706');
    assert.equal(Number(lines[1].amount), 10000, '10% de commission');
    assert.equal(lines[2].code, '442');
    assert.equal(Number(lines[2].amount), 5000, '5% d\'IRF');
    assert.equal(lines[3].code, '571'); // especes -> caisse
    assert.equal(Number(lines[3].amount), 85000, '100000 - 10000 - 5000');
  } finally {
    conn.release();
    await pool.query(
      "UPDATE tenants SET gl_irf_enabled = 0, gl_irf_rate = 0, gl_commission_timing = 'encaissement' WHERE id = :t",
      { t: fx.tenantId },
    );
  }
});

async function balance442(tenantId) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS solde
     FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id JOIN gl_accounts a ON a.id = el.account_id
     WHERE e.tenant_id = :t AND a.code = '442'`,
    { t: tenantId },
  );
  return Number(row.solde);
}

test('reglement_irf : solde le 442, jamais une nouvelle charge', async () => {
  const before = await balance442(fx.tenantId);
  await pool.query('UPDATE tenants SET gl_irf_enabled = 1, gl_irf_rate = 5 WHERE id = :t', { t: fx.tenantId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'reversement_proprietaire',
      entryDate: '2026-02-01',
      amount: 100000,
      paymentMethod: 'virement',
      narrationVars: { proprietaire: 'Propriétaire Test' },
      createdBy: fx.dgId,
      context: { ownerId: fx.ownerId },
    });
    const settlement = await genererEcriture(conn, {
      tenantId: fx.tenantId,
      operationType: 'reglement_irf',
      entryDate: '2026-02-28',
      amount: 5000,
      paymentMethod: 'virement',
      narrationVars: { periode: 'février 2026' },
      createdBy: fx.dgId,
    });
    await conn.commit();

    const [lines] = await pool.query(
      'SELECT el.side, el.amount, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: settlement.entryId },
    );
    assert.equal(lines[0].side, 'debit');
    assert.equal(lines[0].code, '442');
    assert.equal(Number(lines[0].amount), 5000);
    assert.equal(lines[1].side, 'credit');
    assert.equal(lines[1].code, '521');

    const after = await balance442(fx.tenantId);
    assert.equal(after, before, 'retenu (+5000) puis reversé au fisc (-5000) : le solde ne doit pas bouger');
  } finally {
    conn.release();
    await pool.query('UPDATE tenants SET gl_irf_enabled = 0, gl_irf_rate = 0 WHERE id = :t', { t: fx.tenantId });
  }
});

test('payIrf (service) : refuse de régler plus que ce qui est dû, et refuse tout règlement si rien n\'est dû', async () => {
  const fx2 = await createFixture();
  try {
    await assert.rejects(
      () => payIrf(pool, fx2.tenantId, { amount: 1000, paymentMethod: 'especes', paidAt: '2026-01-05', userId: fx2.dgId }),
      /Aucun montant IRF/,
    );

    await pool.query('UPDATE tenants SET gl_irf_enabled = 1, gl_irf_rate = 5 WHERE id = :t', { t: fx2.tenantId });
    await genererEcriture(pool, {
      tenantId: fx2.tenantId,
      operationType: 'reversement_proprietaire',
      entryDate: '2026-01-10',
      amount: 100000,
      paymentMethod: 'virement',
      narrationVars: { proprietaire: 'Propriétaire Test' },
      createdBy: fx2.dgId,
      context: { ownerId: fx2.ownerId },
    });

    const balance = await getIrfBalance(pool, fx2.tenantId);
    assert.equal(balance, 5000);

    await assert.rejects(
      () => payIrf(pool, fx2.tenantId, { amount: 6000, paymentMethod: 'especes', paidAt: '2026-01-15', userId: fx2.dgId }),
      /dépasse ce qui est dû/,
    );

    const result = await payIrf(pool, fx2.tenantId, {
      amount: 5000,
      paymentMethod: 'especes',
      paidAt: '2026-01-15',
      userId: fx2.dgId,
    });
    assert.ok(result.entryId);
    assert.equal(await getIrfBalance(pool, fx2.tenantId), 0);
  } finally {
    await teardown(fx2.tenantId);
  }
});
