'use strict';

/**
 * Bug corrigé (audit sécurité/logique, étape 49) : `resolveCommissionRate`
 * (services/gl/glAccountResolver.js) comparait `ends_on > atDate` (strict)
 * alors que `owners.js` écrit `ends_on` comme le DERNIER JOUR INCLUS de
 * l'ancien taux — le jour exact de `ends_on` tombait donc à 0 % de
 * commission dans le grand livre, alors que `services/commission.js`
 * (tableau de bord, garde-fou de versement) l'aurait correctement compté à
 * l'ancien taux. Ce test reproduit le scénario exact d'un changement de
 * taux et vérifie le dernier jour de validité de l'ancien taux.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { resolveCommissionRate } = require('../../src/services/gl/glAccountResolver');
const { createBareFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();
  // Taux 10 % du 2026-01-01 au 2026-09-30 (dernier jour inclus), puis 15 %
  // à partir du 2026-10-01 — exactement comme `owners.js` les écrit à un
  // changement de taux (ends_on = starts_on du nouveau − 1 jour).
  await pool.query(
    `INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, ends_on, set_by)
     VALUES (:t, :o, 10, '2026-01-01', '2026-09-30', :by)`,
    { t: fx.tenantId, o: fx.ownerId, by: fx.dgId },
  );
  await pool.query(
    `INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, ends_on, set_by)
     VALUES (:t, :o, 15, '2026-10-01', NULL, :by)`,
    { t: fx.tenantId, o: fx.ownerId, by: fx.dgId },
  );
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('resolveCommissionRate — le dernier jour inclus de l\'ancien taux (ends_on) est bien facturé à l\'ANCIEN taux, jamais 0 %', async () => {
  const rate = await resolveCommissionRate(pool, fx.tenantId, fx.ownerId, '2026-09-30');
  assert.equal(rate, 10, 'le 30 septembre est le dernier jour du taux à 10% — ne doit jamais retomber à 0%');
});

test('resolveCommissionRate — le premier jour du nouveau taux applique bien le NOUVEAU taux', async () => {
  const rate = await resolveCommissionRate(pool, fx.tenantId, fx.ownerId, '2026-10-01');
  assert.equal(rate, 15);
});

test('resolveCommissionRate — un jour au milieu de l\'ancien taux reste inchangé', async () => {
  const rate = await resolveCommissionRate(pool, fx.tenantId, fx.ownerId, '2026-05-15');
  assert.equal(rate, 10);
});

test('resolveCommissionRate — aucun taux défini avant le premier -> 0%, jamais une erreur', async () => {
  const rate = await resolveCommissionRate(pool, fx.tenantId, fx.ownerId, '2025-12-31');
  assert.equal(rate, 0);
});
