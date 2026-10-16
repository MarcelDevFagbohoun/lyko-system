'use strict';

/**
 * Clôture facile et claire (étape 54) : prochain mois à clôturer, frise des mois, liste de
 * vérifications, ordre de clôture expliqué, date de démarrage en milieu de mois. Dates calculées
 * par rapport au jour d'exécution (jamais de date fixe qui deviendrait « future » ou trop ancienne).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { shiftMonth, getNextMonthToClose } = require('../src/services/closingOverview');

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
  'Content-Type': 'application/json',
});

const currentMonth = new Date().toISOString().slice(0, 7);
const startMonth = shiftMonth(currentMonth, -3);

async function cleanup(fx) {
  await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
}

test('shiftMonth — décale d\'un nombre de mois, à travers les années', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-11', 3), '2027-02');
});

test('getNextMonthToClose — rien d\'enregistré : rien à clôturer', async () => {
  const fx = await createBareFixture();
  try {
    assert.equal(await getNextMonthToClose(fx.tenantId), null);
  } finally {
    await cleanup(fx);
  }
});

test(
  'GET /closing-overview — date de démarrage en milieu de mois : ce mois est le prochain à clôturer, ' +
    'la frise et la liste de vérifications le décrivent',
  async () => {
    const fx = await createBareFixture();
    try {
      await pool.query('UPDATE tenants SET accounting_start_date = :d WHERE id = :t', { d: `${startMonth}-05`, t: fx.tenantId });
      // Le suivi d'un bail commence à sa création : antidatée pour que le mois de démarrage compte.
      await pool.query("UPDATE leases SET created_at = '2020-01-01 08:00:00' WHERE id = :id", { id: fx.leaseId });
      const res = await fetch(`${baseUrl}/api/accounting/closing-overview`, { headers: bearer(fx.dgId, fx.tenantId) });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.nextMonth, startMonth);
      assert.equal(body.currentMonth, currentMonth);

      const byMonth = Object.fromEntries(body.months.map((m) => [m.month, m.status]));
      assert.equal(byMonth[startMonth], 'pret'); // échéance le 5 + marge, passée depuis longtemps
      assert.equal(byMonth[shiftMonth(startMonth, 1)], 'a_suivre');
      assert.equal(byMonth[currentMonth], 'en_cours');
      assert.equal(byMonth[shiftMonth(startMonth, -1)], 'hors_suivi');

      assert.equal(body.next.month, startMonth);
      assert.equal(body.next.isClosable, true);
      const checks = Object.fromEntries(body.next.checks.map((c) => [c.key, c]));
      assert.equal(checks.echeances.status, 'ok');
      // Bail de la fixture : 50 000 FCFA dus, rien payé — prévient sans bloquer.
      assert.equal(checks.loyers.status, 'attention');
      assert.equal(checks.loyers.remaining, 50000);
      assert.equal(checks.releves.status, 'ok');
      assert.equal(checks.justificatifs.status, 'ok');
    } finally {
      await cleanup(fx);
    }
  },
);

test(
  'POST /periods — sauter un mois est refusé avec le mois à clôturer d\'abord ; le mois de démarrage ' +
    '(en milieu de mois) se clôture, puis le suivant devient le prochain',
  async () => {
    const fx = await createBareFixture();
    try {
      await pool.query('UPDATE tenants SET accounting_start_date = :d WHERE id = :t', { d: `${startMonth}-05`, t: fx.tenantId });

      const skip = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ period: shiftMonth(startMonth, 1) }),
      });
      const skipBody = await skip.json();
      assert.equal(skip.status, 409, JSON.stringify(skipBody));
      assert.match(skipBody.error, /Clôturez d'abord/);

      // Avant l'étape 54 : 409 « doit commencer le …-05 » — un mois civil commence toujours le 1er.
      const ok = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ period: startMonth }),
      });
      assert.equal(ok.status, 201, await ok.text());

      const res = await fetch(`${baseUrl}/api/accounting/closing-overview`, { headers: bearer(fx.dgId, fx.tenantId) });
      const body = await res.json();
      assert.equal(body.nextMonth, shiftMonth(startMonth, 1));
      assert.equal(body.months.find((m) => m.month === startMonth).status, 'cloture');
      assert.equal(body.months.find((m) => m.month === shiftMonth(startMonth, 1)).status, 'pret');
    } finally {
      await cleanup(fx);
    }
  },
);

test('GET /closing-overview — une dépense du mois sans justificatif apparaît dans la liste de vérifications', async () => {
  const fx = await createBareFixture();
  try {
    await pool.query('UPDATE tenants SET accounting_start_date = :d WHERE id = :t', { d: `${startMonth}-01`, t: fx.tenantId });
    const [cols] = await pool.query("SHOW COLUMNS FROM expenses WHERE `Null` = 'NO' AND `Default` IS NULL AND Extra NOT LIKE '%auto_increment%'");
    const required = cols.map((c) => c.Field);
    const values = {
      tenant_id: fx.tenantId,
      category: 'entretien',
      label: 'Ampoules',
      amount: 7000,
      expense_date: `${startMonth}-10`,
      created_by: fx.dgId,
      recorded_by: fx.dgId,
      payment_method: 'especes',
    };
    const fields = required.filter((f) => f in values);
    assert.deepEqual(required.filter((f) => !(f in values)), [], `colonnes obligatoires non prévues : ${required}`);
    await pool.query(
      `INSERT INTO expenses (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
      fields.map((f) => values[f]),
    );

    const res = await fetch(`${baseUrl}/api/accounting/closing-overview`, { headers: bearer(fx.dgId, fx.tenantId) });
    const body = await res.json();
    const receipts = body.next.checks.find((c) => c.key === 'justificatifs');
    assert.equal(receipts.status, 'attention');
    assert.equal(receipts.count, 1);
    assert.equal(receipts.total, 7000);
  } finally {
    await pool.query('DELETE FROM expenses WHERE tenant_id = :t', { t: fx.tenantId });
    await cleanup(fx);
  }
});
