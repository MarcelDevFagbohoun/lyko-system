'use strict';

/**
 * Bug corrigé (même famille que la facture SONEB/SBEE en double, signalée par l'utilisateur
 * le 2026-10-17) : `POST /fixed-assets/:id/depreciate` et `POST /fixed-assets/:id/dispose`
 * vérifiaient leur condition (période déjà amortie / déjà sortie) AVANT la transaction, sans
 * verrou — un double-clic (deux requêtes quasi simultanées) pouvait passer les deux fois cette
 * vérification. Ces tests reproduisent la vraie concurrence (Promise.all, pas un simple
 * deuxième appel séquentiel) pour prouver qu'exactement une des deux requêtes réussit.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;
let server;
let baseUrl;

before(async () => {
  fx = await createBareFixture();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
  'Content-Type': 'application/json',
});

async function insertFixedAsset() {
  const [result] = await pool.query(
    `INSERT INTO fixed_assets (tenant_id, label, category, acquisition_date, acquisition_cost, useful_life_years, payment_status, created_by)
     VALUES (:t, 'Ordinateur portable', 'informatique', '2026-01-01', 1200000, 3, 'paid', :by)`,
    { t: fx.tenantId, by: fx.dgId },
  );
  return result.insertId;
}

test(
  "POST /fixed-assets/:id/depreciate — deux requêtes simultanées pour le MÊME mois : une seule " +
    "réussit (201), l'autre est refusée (409), un seul amortissement enregistré",
  async () => {
    const assetId = await insertFixedAsset();

    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/accounting/fixed-assets/${assetId}/depreciate`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ period: '2026-02' }),
      }),
      fetch(`${baseUrl}/api/accounting/fixed-assets/${assetId}/depreciate`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({ period: '2026-02' }),
      }),
    ]);
    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [201, 409]);

    const [rows] = await pool.query('SELECT id FROM fixed_asset_depreciations WHERE fixed_asset_id = :id', { id: assetId });
    assert.equal(rows.length, 1, 'un seul amortissement doit exister pour ce mois');
  },
);

test(
  "POST /fixed-assets/:id/dispose — deux requêtes simultanées sur la MÊME immobilisation : une " +
    "seule réussit (200), l'autre est refusée (409), un seul passage à 'disposed'",
  async () => {
    const assetId = await insertFixedAsset();

    const payload = { disposedAt: '2026-03-01', reason: 'Vendu à un tiers' };
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/accounting/fixed-assets/${assetId}/dispose`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify(payload),
      }),
      fetch(`${baseUrl}/api/accounting/fixed-assets/${assetId}/dispose`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify(payload),
      }),
    ]);
    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409]);

    const [[row]] = await pool.query('SELECT status FROM fixed_assets WHERE id = :id', { id: assetId });
    assert.equal(row.status, 'disposed');
  },
);
