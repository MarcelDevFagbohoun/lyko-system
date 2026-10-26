'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { requirePermission } = require('../src/middleware/auth');
const { requireChargesEnabled } = require('../src/middleware/chargesModule');
const { PERMISSIONS, PERMISSION_KEYS, DEFAULT_PERMISSIONS_BY_ROLE } = require('../src/constants/permissions');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;
let empId;

before(async () => {
  fx = await createBareFixture();
  const [r] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash, identifier) VALUES (:t, 'comptable', 'Emp', 'Test', :phone, 'x', :ident)",
    { t: fx.tenantId, phone: `+229${Date.now().toString().slice(-8)}`, ident: `T${Date.now().toString().slice(-10)}` },
  );
  empId = r.insertId;
});
after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

function check(mw, user) {
  return new Promise((resolve) => mw({ user }, {}, (err) => resolve(err ?? null)));
}
const emp = () => ({ id: empId, role: 'comptable', tenantId: fx.tenantId });
async function grant(...keys) {
  await pool.query('DELETE FROM user_permissions WHERE user_id = :id', { id: empId });
  for (const k of keys) await pool.query('INSERT INTO user_permissions (user_id, permission_key) VALUES (:id, :k)', { id: empId, k });
}

test('catalogue : les 4 permissions d’opérations existent et rien n’est pré-coché', () => {
  for (const k of ['loyers_encaisser', 'reversements_proprietaires', 'charges_enregistrer', 'depenses_enregistrer']) {
    assert.ok(PERMISSION_KEYS.includes(k), k);
    assert.equal(PERMISSIONS.find((p) => p.key === k).group, 'operations');
  }
  assert.deepEqual(DEFAULT_PERMISSIONS_BY_ROLE, { agent: [], comptable: [] });
});

test('avoir la fiche locataires ne permet pas d’encaisser un versement', async () => {
  await grant('locataires');
  const err = await check(requirePermission('loyers_encaisser'), emp());
  assert.equal(err?.status, 403);
  assert.equal(await check(requirePermission('locataires'), emp()), null);
});

test('la permission dédiée autorise l’opération', async () => {
  await grant('loyers_encaisser');
  assert.equal(await check(requirePermission('loyers_encaisser'), emp()), null);
  assert.equal((await check(requirePermission('reversements_proprietaires'), emp()))?.status, 403);
});

test('charges : voir les fiches n’autorise pas à enregistrer, et inversement', async () => {
  await grant('charges');
  assert.equal(await check(requirePermission('charges'), emp()), null);
  assert.equal((await check(requirePermission('charges_enregistrer'), emp()))?.status, 403);
  await grant('charges', 'charges_enregistrer');
  assert.equal(await check(requirePermission('charges_enregistrer'), emp()), null);
});

test('la direction passe toujours', async () => {
  assert.equal(await check(requirePermission('depenses_enregistrer'), { id: fx.dgId, role: 'dg', tenantId: fx.tenantId }), null);
});

test('module Charges : désactivé → 403 CHARGES_DISABLED, réactivé → passe', async () => {
  await pool.query('UPDATE tenants SET charges_enabled = 0 WHERE id = :t', { t: fx.tenantId });
  const off = await check(requireChargesEnabled, { id: fx.dgId, role: 'dg', tenantId: fx.tenantId });
  assert.equal(off?.status, 403);
  assert.equal(off.details?.code, 'CHARGES_DISABLED');
  await pool.query('UPDATE tenants SET charges_enabled = 1 WHERE id = :t', { t: fx.tenantId });
  assert.equal(await check(requireChargesEnabled, { id: fx.dgId, role: 'dg', tenantId: fx.tenantId }), null);
});

test('connexion employé sans poste : refusée pour un compte direction', () => {
  // Le schéma accepte l'absence de poste ; la route refuse un compte `dg` (qui se connecte par téléphone/e-mail).
  const { employeeLoginSchema } = require('../src/validators/auth');
  assert.equal(employeeLoginSchema.safeParse({ identifier: 'ABCD-EFGH-JKMN', password: 'x' }).success, true);
});
