'use strict';

/**
 * Audit comptabilité avancée (point 9, 16/10/2026) : si personne n'ouvre le prochain exercice comptable
 * à temps, TOUTE opération financière du cabinet (loyer, dépense, versement, charge...) échoue dès le
 * lendemain de la fin de l'exercice en cours (`resolveOpenFiscalYear`, volontaire) — jamais signalé à
 * l'avance nulle part ailleurs que, réactivement, dans l'onglet Comptabilité avancée lui-même. Ce job
 * avertit le DG PENDANT qu'il est encore temps d'ouvrir le suivant.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { runFiscalYearExpiryJob } = require('../../src/jobs/fiscalYearExpiryJob');
const { createFixture, teardown } = require('./fixtures');

const createdTenantIds = [];

async function enabledFixture() {
  const fx = await createFixture(); // exercice '2026', 2026-01-01 → 2026-12-31
  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: fx.tenantId });
  createdTenantIds.push(fx.tenantId);
  return fx;
}

async function notificationsOf(tenantId) {
  const [rows] = await pool.query(
    "SELECT message, entity_id FROM gl_notifications WHERE tenant_id = :t AND type = 'fiscal_year_ending_soon'",
    { t: tenantId },
  );
  return rows;
}

after(async () => {
  for (const tenantId of createdTenantIds) await teardown(tenantId);
  await closePool();
});

test("plus de 30 jours avant la fin de l'exercice : aucune alerte", async () => {
  const fx = await enabledFixture();
  await runFiscalYearExpiryJob({ tenantIds: [fx.tenantId], today: '2026-11-01' }); // 60 jours avant le 31/12
  assert.deepEqual(await notificationsOf(fx.tenantId), []);
});

test("dans la marge des 30 jours avant la fin de l'exercice : une alerte, jamais répétée le même jour", async () => {
  const fx = await enabledFixture();
  await runFiscalYearExpiryJob({ tenantIds: [fx.tenantId], today: '2026-12-10' }); // 21 jours avant le 31/12
  await runFiscalYearExpiryJob({ tenantIds: [fx.tenantId], today: '2026-12-10' }); // même jour : dédoublonné

  const rows = await notificationsOf(fx.tenantId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_id, fx.fiscalYearId);
  assert.match(rows[0].message, /2026-12-31/);
  assert.match(rows[0].message, /ouvrir le suivant/);
});

test("le prochain exercice est DÉJÀ ouvert : aucune alerte, le DG a déjà anticipé", async () => {
  const fx = await enabledFixture();
  await pool.query(
    "INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:t, '2027', '2027-01-01', '2027-12-31', 'ouvert')",
    { t: fx.tenantId },
  );
  await runFiscalYearExpiryJob({ tenantIds: [fx.tenantId], today: '2026-12-10' });
  assert.deepEqual(await notificationsOf(fx.tenantId), []);
});

test("module comptabilité avancée désactivé : jamais d'alerte, même dans la marge", async () => {
  const fx = await createFixture(); // `gl_module_enabled` reste à 0 (valeur par défaut) — volontairement PAS activé
  createdTenantIds.push(fx.tenantId);
  await runFiscalYearExpiryJob({ tenantIds: [fx.tenantId], today: '2026-12-10' });
  assert.deepEqual(await notificationsOf(fx.tenantId), []);
});

test("après la fin de l'exercice (déjà en situation de blocage réel) : plus du ressort de ce rappel préventif", async () => {
  // Le lendemain de la fin, l'échec se produit déjà réellement (`resolveOpenFiscalYear`) — ce job ne
  // double-alerte pas indéfiniment au-delà, il a eu sa fenêtre (30 jours avant la fin).
  const fx = await enabledFixture();
  await runFiscalYearExpiryJob({ tenantIds: [fx.tenantId], today: '2027-01-15' });
  assert.deepEqual(await notificationsOf(fx.tenantId), []);
});
