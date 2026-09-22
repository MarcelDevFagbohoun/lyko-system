'use strict';

/**
 * `syncAccountSystemKeys` — même défaut que `syncMissingPostingRules`, mais
 * sur `gl_accounts.system_key` : la vraie panne rencontrée en direct sur
 * KIko Store (compte 4671 seedé avant l'introduction de `system_key =
 * 'owner_control_account'`, migration 050 — `system_key` restait NULL pour
 * toujours, faisant échouer `getOrCreateThirdParty('owner', ...)` sur un
 * tenant pourtant déjà actif). Doit rattacher UNIQUEMENT les comptes dont le
 * `system_key` est encore NULL, sans jamais toucher un compte déjà correct.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { syncAccountSystemKeys } = require('../../src/db/seedGeneralLedger');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('syncAccountSystemKeys — rattache un system_key resté NULL, sans toucher les autres', async () => {
  // Simule un tenant seedé avant l'introduction de `owner_control_account`
  // (comme KIko Store) : on efface le system_key après le seed complet.
  await pool.query("UPDATE gl_accounts SET system_key = NULL WHERE tenant_id = :t AND code = '4671'", {
    t: fx.tenantId,
  });

  const result = await syncAccountSystemKeys(fx.tenantId);
  assert.deepEqual(result.updated, ['owner_control_account']);

  const [[account]] = await pool.query("SELECT system_key FROM gl_accounts WHERE tenant_id = :t AND code = '4671'", {
    t: fx.tenantId,
  });
  assert.equal(account.system_key, 'owner_control_account');

  // Un compte déjà correctement rattaché (707, late_fee_income_account) ne
  // doit jamais être touché par ce passage.
  const [[lateFee]] = await pool.query("SELECT system_key FROM gl_accounts WHERE tenant_id = :t AND code = '707'", {
    t: fx.tenantId,
  });
  assert.equal(lateFee.system_key, 'late_fee_income_account');
});

test('syncAccountSystemKeys — ne rattache plus rien une fois tout à jour', async () => {
  const result = await syncAccountSystemKeys(fx.tenantId);
  assert.deepEqual(result.updated, []);
});

test('syncAccountSystemKeys — ne touche jamais un system_key déjà différent', async () => {
  // Valeur volontairement arbitraire (jamais utilisée par le catalogue réel)
  // pour ne pas heurter l'UNIQUE KEY (tenant_id, system_key) — seul le
  // comportement de non-écrasement est testé ici.
  await pool.query("UPDATE gl_accounts SET system_key = 'placeholder_test_value' WHERE tenant_id = :t AND code = '707'", {
    t: fx.tenantId,
  });

  await syncAccountSystemKeys(fx.tenantId);

  const [[lateFee]] = await pool.query("SELECT system_key FROM gl_accounts WHERE tenant_id = :t AND code = '707'", {
    t: fx.tenantId,
  });
  assert.equal(lateFee.system_key, 'placeholder_test_value', 'un system_key déjà renseigné ne doit jamais être écrasé');

  // Remise en état pour ne pas fausser un test ultérieur qui réutiliserait ce fixture.
  await pool.query("UPDATE gl_accounts SET system_key = 'late_fee_income_account' WHERE tenant_id = :t AND code = '707'", {
    t: fx.tenantId,
  });
});
