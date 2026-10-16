'use strict';

/**
 * Refonte de la clôture (étape 1/5, 2026-10-16) : rythme de période configurable par entreprise
 * (socle). Chaque garantie testée ici est une décision explicite de l'utilisateur ou une correction
 * trouvée en concevant cette étape — voir le plan ("Refonte de la clôture") :
 *  - 'calendaire' reste le défaut pour toute entreprise, zéro changement de comportement visible.
 *  - continuité stricte : la période suivante commence toujours le lendemain de la fin de la
 *    précédente, jamais de trou ni de chevauchement.
 *  - le nouveau point de verrouillage (la ligne du tenant, plus un gap-lock sur une clé qui n'existe
 *    plus) sérialise bien deux clôtures concurrentes.
 *  - rythmes 'jour_fixe'/'libre' : testables par appel API direct, pas encore d'interface.
 *  - emboîtement avec l'exercice SYSCOHADA quand le module est actif.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, createFixture, teardown } = require('./gl/fixtures');

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

async function cleanupTenant(tenantId) {
  await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t', { t: tenantId });
}

test('GET /api/accounting/rhythm — une entreprise fraîche est en rythme "calendaire" par défaut', async () => {
  const fx = await createBareFixture();
  try {
    const res = await fetch(`${baseUrl}/api/accounting/rhythm`, { headers: bearer(fx.dgId, fx.tenantId) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { mode: 'calendaire', startDay: null });
  } finally {
    await teardown(fx.tenantId);
  }
});

test(
  'POST /api/accounting/periods — rythme calendaire INCHANGÉ : clôture normale, la réponse ' +
    'inclut désormais periodStart/periodEnd en plus de period/forced',
  async () => {
    const fx = await createBareFixture();
    try {
      const res = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ period: '2026-01' }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.period, '2026-01');
      assert.equal(body.periodStart, '2026-01-01');
      assert.equal(body.periodEnd, '2026-01-31');
      assert.equal(body.forced, false);
      assert.equal(body.fiscalYearClosable, false);
    } finally {
      await cleanupTenant(fx.tenantId);
      await teardown(fx.tenantId);
    }
  },
);

test(
  'POST /api/accounting/periods — continuité stricte : impossible de sauter un mois, le message ' +
    "indique la date de début attendue",
  async () => {
    const fx = await createBareFixture();
    try {
      const jan = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ period: '2026-01' }),
      });
      assert.equal(jan.status, 201);

      // Saute février : doit être refusé.
      const mars = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ period: '2026-03' }),
      });
      assert.equal(mars.status, 409);
      const marsBody = await mars.json();
      assert.match(marsBody.error, /2026-02-01/);

      // Février, dans l'ordre : accepté.
      const fev = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ period: '2026-02' }),
      });
      assert.equal(fev.status, 201);
      const fevBody = await fev.json();
      assert.equal(fevBody.periodStart, '2026-02-01');
    } finally {
      await cleanupTenant(fx.tenantId);
      await teardown(fx.tenantId);
    }
  },
);

test(
  'POST /api/accounting/periods — deux clôtures concurrentes pour la MÊME période suivante : ' +
    'une seule réussit (nouveau verrou sur la ligne du tenant)',
  async () => {
    const fx = await createBareFixture();
    try {
      const jan = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ period: '2026-01' }),
      });
      assert.equal(jan.status, 201);

      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/accounting/periods`, {
          method: 'POST',
          headers: bearer(fx.dgId, fx.tenantId),
          body: JSON.stringify({ period: '2026-02' }),
        }),
        fetch(`${baseUrl}/api/accounting/periods`, {
          method: 'POST',
          headers: bearer(fx.dgId, fx.tenantId),
          body: JSON.stringify({ period: '2026-02' }),
        }),
      ]);
      const statuses = [res1.status, res2.status].sort();
      assert.deepEqual(statuses, [201, 409]);

      const [rows] = await pool.query(
        "SELECT id FROM accounting_periods WHERE tenant_id = :t AND period_start = '2026-02-01'",
        { t: fx.tenantId },
      );
      assert.equal(rows.length, 1, 'une seule période de février doit exister');
    } finally {
      await cleanupTenant(fx.tenantId);
      await teardown(fx.tenantId);
    }
  },
);

test(
  'POST /api/accounting/periods — rythme "jour_fixe" : periodStart/periodEnd dérivés du jour ' +
    "d'ancrage, préservés d'une clôture à l'autre par continuité",
  async () => {
    const fx = await createBareFixture();
    try {
      await fetch(`${baseUrl}/api/accounting/start-date`, {
        method: 'PATCH',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ startDate: '2026-01-05' }),
      });
      await pool.query("UPDATE tenants SET period_rhythm_mode = 'jour_fixe', period_start_day = 5 WHERE id = :t", { t: fx.tenantId });

      const first = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ force: true }), // pas de margin-based closability en jour_fixe (étape 1)
      });
      assert.equal(first.status, 201);
      const firstBody = await first.json();
      assert.equal(firstBody.period, null);
      assert.equal(firstBody.periodStart, '2026-01-05');
      assert.equal(firstBody.periodEnd, '2026-02-04');

      const second = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ force: true }),
      });
      assert.equal(second.status, 201);
      const secondBody = await second.json();
      assert.equal(secondBody.periodStart, '2026-02-05');
      assert.equal(secondBody.periodEnd, '2026-03-04');
    } finally {
      await cleanupTenant(fx.tenantId);
      await teardown(fx.tenantId);
    }
  },
);

test(
  'POST /api/accounting/periods — rythme "libre" : date de fin obligatoire, continuité toujours ' +
    'imposée pour la période suivante',
  async () => {
    const fx = await createBareFixture();
    try {
      await fetch(`${baseUrl}/api/accounting/start-date`, {
        method: 'PATCH',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ startDate: '2026-01-10' }),
      });
      await pool.query("UPDATE tenants SET period_rhythm_mode = 'libre', period_start_day = NULL WHERE id = :t", { t: fx.tenantId });

      const missingEnd = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ force: true }),
      });
      assert.equal(missingEnd.status, 400);

      const first = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ periodEnd: '2026-01-31', force: true }),
      });
      assert.equal(first.status, 201);
      assert.deepEqual(await first.json().then((b) => [b.periodStart, b.periodEnd]), ['2026-01-10', '2026-01-31']);

      // La suivante doit commencer le 2026-02-01 (lendemain), peu importe la date de fin choisie.
      const wrongStart = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ periodEnd: '2026-02-20', force: true }),
      });
      assert.equal(wrongStart.status, 201);
      const body = await wrongStart.json();
      assert.equal(body.periodStart, '2026-02-01');
      assert.equal(body.periodEnd, '2026-02-20');
    } finally {
      await cleanupTenant(fx.tenantId);
      await teardown(fx.tenantId);
    }
  },
);

test(
  'POST /api/accounting/periods — emboîtement SYSCOHADA : la clôture est refusée si la période ' +
    'chevauche deux exercices, acceptée sinon, et signale fiscalYearClosable sur la dernière',
  async () => {
    const fx = await createFixture(); // inclut un exercice 'ouvert' 2026-01-01..2026-12-31 (fx.fiscalYearId)
    await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: fx.tenantId });
    // Déplace l'exercice sur 2025 (entièrement dans le passé par rapport à "aujourd'hui" — le test
    // doit clôturer jusqu'à décembre, impossible avec l'exercice 2026 par défaut car décembre 2026
    // n'est pas encore passé).
    await pool.query(
      "UPDATE gl_fiscal_years SET start_date = '2025-01-01', end_date = '2025-12-31', label = '2025' WHERE id = :id",
      { id: fx.fiscalYearId },
    );
    try {
      // Janvier à juin tombe entièrement dans l'exercice 2025 : accepté, pas encore la dernière période.
      for (const period of ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06']) {
        const res = await fetch(`${baseUrl}/api/accounting/periods`, {
          method: 'POST',
          headers: bearer(fx.dgId, fx.tenantId),
          body: JSON.stringify({ period }),
        });
        assert.equal(res.status, 201, `${period} devrait être accepté`);
        const body = await res.json();
        assert.equal(body.fiscalYearClosable, false);
      }

      for (const period of ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11']) {
        const res = await fetch(`${baseUrl}/api/accounting/periods`, {
          method: 'POST',
          headers: bearer(fx.dgId, fx.tenantId),
          body: JSON.stringify({ period }),
        });
        assert.equal(res.status, 201, `${period} devrait être accepté`);
      }

      // Décembre atteint exactement la fin de l'exercice : fiscalYearClosable devient vrai.
      const dec = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ period: '2025-12' }),
      });
      assert.equal(dec.status, 201);
      assert.equal((await dec.json()).fiscalYearClosable, true);
    } finally {
      await cleanupTenant(fx.tenantId);
      await teardown(fx.tenantId);
    }
  },
);

test(
  'POST /api/accounting/periods — emboîtement SYSCOHADA : rejette une période qui chevauche ' +
    'deux exercices distincts',
  async () => {
    const fx = await createFixture();
    await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: fx.tenantId });
    // Un second exercice juste avant le premier (2025), tous deux dans le passé — nécessaire car la
    // route rejette une date de fin future ; on ne peut pas utiliser 2027 ici.
    await pool.query(
      "UPDATE gl_fiscal_years SET start_date = '2025-01-01', end_date = '2025-12-31', label = '2025' WHERE id = :id",
      { id: fx.fiscalYearId },
    );
    await pool.query(
      "INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:t, '2026', '2026-01-01', '2026-12-31', 'ouvert')",
      { t: fx.tenantId },
    );
    try {
      await pool.query("UPDATE tenants SET period_rhythm_mode = 'libre', period_start_day = NULL WHERE id = :t", { t: fx.tenantId });
      await pool.query('UPDATE tenants SET accounting_start_date = :d WHERE id = :t', { d: '2025-12-01', t: fx.tenantId });

      const straddling = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ periodEnd: '2026-01-15', force: true }),
      });
      assert.equal(straddling.status, 409);
      const body = await straddling.json();
      assert.match(body.error, /chevauche deux exercices/);
    } finally {
      await cleanupTenant(fx.tenantId);
      await teardown(fx.tenantId);
    }
  },
);
