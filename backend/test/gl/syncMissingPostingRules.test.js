'use strict';

/**
 * `syncMissingPostingRules` — le mécanisme sûr pour rattraper les types
 * d'opération apparus après l'activation d'un tenant (voir la vraie panne
 * rencontrée sur KIko Store : le module restait actif en continu, jamais
 * réactivé, donc jamais resynchronisé). Doit ajouter UNIQUEMENT ce qui
 * manque, sans jamais toucher une règle déjà présente.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { syncMissingPostingRules } = require('../../src/db/seedGeneralLedger');
const { createFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('syncMissingPostingRules — ajoute une règle absente, sans toucher aux autres', async () => {
  // Simule un tenant activé avant l'apparition de `dette_initiale_encaissee`
  // (comme KIko Store) : on retire cette règle après le seed complet.
  await pool.query(
    `DELETE prl FROM gl_posting_rule_lines prl
     JOIN gl_posting_rules pr ON pr.id = prl.rule_id
     WHERE pr.tenant_id = :t AND pr.operation_type = 'dette_initiale_encaissee'`,
    { t: fx.tenantId },
  );
  await pool.query("DELETE FROM gl_posting_rules WHERE tenant_id = :t AND operation_type = 'dette_initiale_encaissee'", {
    t: fx.tenantId,
  });

  const [[before1]] = await pool.query('SELECT id FROM gl_posting_rules WHERE tenant_id = :t AND operation_type = :op', {
    t: fx.tenantId,
    op: 'loyer_encaisse',
  });

  const result = await syncMissingPostingRules(fx.tenantId);
  assert.deepEqual(result.added, ['dette_initiale_encaissee']);

  const [[rule]] = await pool.query(
    "SELECT id FROM gl_posting_rules WHERE tenant_id = :t AND operation_type = 'dette_initiale_encaissee'",
    { t: fx.tenantId },
  );
  assert.ok(rule, 'la règle manquante doit être créée');

  const [lines] = await pool.query('SELECT * FROM gl_posting_rule_lines WHERE rule_id = :id', { id: rule.id });
  assert.equal(lines.length, 3, 'debit trésorerie + credit 706 + credit tiers propriétaire');

  // Une règle déjà présente (loyer_encaisse) ne doit jamais être recréée
  // (même id qu'avant).
  const [[after1]] = await pool.query('SELECT id FROM gl_posting_rules WHERE tenant_id = :t AND operation_type = :op', {
    t: fx.tenantId,
    op: 'loyer_encaisse',
  });
  assert.equal(after1.id, before1.id);
});

test('syncMissingPostingRules — ne rajoute rien si tout est déjà présent', async () => {
  const result = await syncMissingPostingRules(fx.tenantId);
  assert.deepEqual(result.added, []);
});

test('syncMissingPostingRules — refuse un tenant sans plan comptable initialisé', async () => {
  await assert.rejects(() => syncMissingPostingRules(999999999), /Plan comptable non initialisé/);
});
