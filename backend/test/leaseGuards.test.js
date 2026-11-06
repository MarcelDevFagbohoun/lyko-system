'use strict';

/**
 * Garde d'écriture sur un bail archivé (demande utilisateur, 2026-11-06) : « qu'on ne puisse effectuer
 * aucune opération ou action sur son dossier après l'archive ». Test pur sur `assertLeaseNotArchived`
 * (aucune base requise) — la couverture des points d'entrée (complaints.js, utilityCharges.js,
 * relances.js, leasePayments.js, moveInReport.js, moveOutReport.js, leaseContractActions.js) qui
 * l'appellent est, elle, nécessairement en base (voir vérification live).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { assertLeaseNotArchived } = require('../src/services/leaseGuards');
const { ApiError } = require('../src/middleware/error');

test('assertLeaseNotArchived — ne lève rien quand archived_at est null/absent', () => {
  assert.doesNotThrow(() => assertLeaseNotArchived({ archived_at: null }));
  assert.doesNotThrow(() => assertLeaseNotArchived({}));
});

test('assertLeaseNotArchived — lève une 409 quand archived_at est posé', () => {
  assert.throws(
    () => assertLeaseNotArchived({ archived_at: new Date() }),
    (err) => err instanceof ApiError && err.status === 409,
  );
});

test('assertLeaseNotArchived — ne plante pas si on lui passe undefined/null (défense en profondeur)', () => {
  assert.doesNotThrow(() => assertLeaseNotArchived(undefined));
  assert.doesNotThrow(() => assertLeaseNotArchived(null));
});
