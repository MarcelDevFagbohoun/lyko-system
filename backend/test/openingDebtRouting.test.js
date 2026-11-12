'use strict';

/**
 * Routage des impayés à l'entrée par type (demande utilisateur, 2026-11-12) : « si c'est un impayé
 * de loyer ça doit se figurer dans les relances du mois, si c'est SBEE [ou SONEB] dans les charges,
 * et autres doit être dans les alertes ». Vérifie que :
 *  - seul le poste « loyer » compte dans `openingDebtRemaining` du Centre de relance
 *    (GET /api/accounting/arrears) — SBEE/SONEB/poubelle/autre n'y gonflent plus rien ;
 *  - SBEE/SONEB restants apparaissent dans GET /api/opening-debt-charges ;
 *  - poubelle/autre restants apparaissent comme alerte dans GET /api/utility-alerts ;
 *  - une dette héritée SANS détail par poste (`opening_debt_amount` seul, avant la migration 151)
 *    garde son comportement historique : comptée en entier comme loyer, invisible des deux autres.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');

let fx; let server; let base;
const hdr = (userId, role) => ({ Authorization: `Bearer ${signAccessToken({ sub: userId, tenantId: fx.tenantId, role })}` });

before(async () => {
  fx = await createFixture();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await teardown(fx.tenantId);
  await closePool();
});

test('loyer compte dans les relances, SBEE dans les charges, poubelle dans les alertes — jamais mélangés', async () => {
  await pool.query(
    `INSERT INTO lease_opening_debt_items (tenant_id, lease_id, debt_type, period_month, amount, created_by) VALUES
       (:t, :l, 'loyer', '2026-09', 20000, :by),
       (:t, :l, 'sbee', '2026-09', 15000, :by),
       (:t, :l, 'poubelle', '2026-09', 5000, :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );

  // 1) Centre de relance : seul le poste loyer doit gonfler openingDebtRemaining.
  const arrearsRes = await fetch(`${base}/api/accounting/arrears`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(arrearsRes.status, 200);
  const { arrears } = await arrearsRes.json();
  const row = arrears.find((a) => a.leaseId === fx.leaseId);
  assert.ok(row, 'le bail doit apparaître (poste loyer impayé)');
  assert.equal(row.openingDebtRemaining, 20000, 'SBEE et poubelle ne doivent plus compter ici');

  // 2) Carte Charges : seul SBEE doit apparaître.
  const chargesRes = await fetch(`${base}/api/opening-debt-charges`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(chargesRes.status, 200);
  const { items: chargeItems } = await chargesRes.json();
  const sbeeItem = chargeItems.find((it) => it.leaseId === fx.leaseId);
  assert.ok(sbeeItem, 'le poste SBEE doit apparaître dans la carte Charges');
  assert.equal(sbeeItem.debtType, 'sbee');
  assert.equal(sbeeItem.remaining, 15000);
  assert.ok(!chargeItems.some((it) => it.leaseId === fx.leaseId && it.debtType === 'loyer'), 'jamais le loyer ici');

  // 3) Alertes : seul poubelle doit apparaître.
  const alertsRes = await fetch(`${base}/api/utility-alerts`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(alertsRes.status, 200);
  const { alerts } = await alertsRes.json();
  const otherAlert = alerts.find((a) => a.type === 'impaye_entree_autre' && a.leaseId === fx.leaseId);
  assert.ok(otherAlert, 'une alerte « impayé à l\'entrée autre » doit exister pour ce bail');
  assert.equal(otherAlert.amount, 5000);

  await pool.query('DELETE FROM lease_opening_debt_items WHERE lease_id = :id', { id: fx.leaseId });
});

test('dette héritée en vrac (sans poste) : comportement historique préservé, invisible des deux autres destinations', async () => {
  await pool.query('UPDATE leases SET opening_debt_amount = 30000 WHERE id = :id', { id: fx.leaseId });

  const arrearsRes = await fetch(`${base}/api/accounting/arrears`, { headers: hdr(fx.dgId, 'dg') });
  const { arrears } = await arrearsRes.json();
  const row = arrears.find((a) => a.leaseId === fx.leaseId);
  assert.ok(row);
  assert.equal(row.openingDebtRemaining, 30000, 'sans poste détaillé, tout reste compté comme loyer (historique)');

  const chargesRes = await fetch(`${base}/api/opening-debt-charges`, { headers: hdr(fx.dgId, 'dg') });
  const { items: chargeItems } = await chargesRes.json();
  assert.ok(!chargeItems.some((it) => it.leaseId === fx.leaseId), 'aucun poste détaillé : rien à montrer dans Charges');

  const alertsRes = await fetch(`${base}/api/utility-alerts`, { headers: hdr(fx.dgId, 'dg') });
  const { alerts } = await alertsRes.json();
  assert.ok(!alerts.some((a) => a.type === 'impaye_entree_autre' && a.leaseId === fx.leaseId));

  await pool.query('UPDATE leases SET opening_debt_amount = 0 WHERE id = :id', { id: fx.leaseId });
});
