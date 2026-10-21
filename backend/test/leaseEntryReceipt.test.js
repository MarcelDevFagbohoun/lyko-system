'use strict';

/**
 * Reçu d'entrée (demande utilisateur, 2026-10-17) : regroupe caution, frais d'agence, cautions
 * supplémentaires (SBEE/SONEB/peinture) et prorata en UN reçu dès que l'un d'eux a réellement été
 * payé à la signature du bail — voir `services/leaseEntryReceipt.js`. Tests purs sur
 * `buildEntryReceiptLines` (aucune base requise) ; `createEntryReceiptIfAnyPayment` (qui insère en
 * base) est couvert par les tests d'intégration de `routes/renters.js` (voir `test/renters*.test.js`
 * si présent, sinon vérifié en direct — voir vérification live).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildEntryReceiptLines } = require('../src/services/leaseEntryReceipt');

function baseLease(overrides = {}) {
  return {
    deposit_amount: 0,
    deposit_received_at: null,
    entry_fee_amount: 0,
    entry_fee_received_at: null,
    entry_prorata_amount: 0,
    entry_prorata_received_at: null,
    entry_prorata_days: null,
    ...overrides,
  };
}

test('buildEntryReceiptLines — aucun paiement à la signature renvoie une liste vide, total 0', () => {
  const { lines, total } = buildEntryReceiptLines(baseLease());
  assert.deepEqual(lines, []);
  assert.equal(total, 0);
});

test('buildEntryReceiptLines — caution seule, réellement reçue', () => {
  const lease = baseLease({ deposit_amount: 100000, deposit_received_at: new Date('2026-10-17') });
  const { lines, total } = buildEntryReceiptLines(lease);
  assert.deepEqual(lines, [{ label: 'Caution de loyer', amount: 100000 }]);
  assert.equal(total, 100000);
});

test('buildEntryReceiptLines — un montant déclaré mais JAMAIS marqué reçu n’apparaît pas (received_at absent)', () => {
  const lease = baseLease({ deposit_amount: 100000, deposit_received_at: null });
  const { lines, total } = buildEntryReceiptLines(lease);
  assert.deepEqual(lines, []);
  assert.equal(total, 0);
});

test('buildEntryReceiptLines — frais d’agence non remboursables, libellé explicite', () => {
  const lease = baseLease({ entry_fee_amount: 25000, entry_fee_received_at: new Date('2026-10-17') });
  const { lines } = buildEntryReceiptLines(lease);
  assert.deepEqual(lines, [{ label: "Frais d'agence (non remboursables)", amount: 25000 }]);
});

test('buildEntryReceiptLines — prorata d’entrée avec le nombre de jours au pluriel/singulier', () => {
  const singular = buildEntryReceiptLines(
    baseLease({ entry_prorata_amount: 3000, entry_prorata_received_at: new Date('2026-10-17'), entry_prorata_days: 1 }),
  );
  assert.deepEqual(singular.lines, [{ label: "Loyer — prorata d'entrée (1 jour)", amount: 3000 }]);

  const plural = buildEntryReceiptLines(
    baseLease({ entry_prorata_amount: 15000, entry_prorata_received_at: new Date('2026-10-17'), entry_prorata_days: 5 }),
  );
  assert.deepEqual(plural.lines, [{ label: "Loyer — prorata d'entrée (5 jours)", amount: 15000 }]);
});

test('buildEntryReceiptLines — cautions supplémentaires (SBEE/SONEB/peinture), dans l’ordre fourni', () => {
  const additionalDeposits = [
    { typeLabel: 'Caution SBEE (électricité)', amount: 10000 },
    { typeLabel: 'Caution SONEB (eau)', amount: 8000 },
  ];
  const { lines, total } = buildEntryReceiptLines(baseLease(), additionalDeposits);
  assert.deepEqual(lines, [
    { label: 'Caution SBEE (électricité)', amount: 10000 },
    { label: 'Caution SONEB (eau)', amount: 8000 },
  ]);
  assert.equal(total, 18000);
});

test('buildEntryReceiptLines — tout combiné, total = somme de toutes les lignes réellement payées', () => {
  const lease = baseLease({
    deposit_amount: 100000,
    deposit_received_at: new Date('2026-10-17'),
    entry_fee_amount: 25000,
    entry_fee_received_at: new Date('2026-10-17'),
    entry_prorata_amount: 15000,
    entry_prorata_received_at: new Date('2026-10-17'),
    entry_prorata_days: 5,
  });
  const additionalDeposits = [{ typeLabel: 'Caution peinture', amount: 20000 }];
  const { lines, total } = buildEntryReceiptLines(lease, additionalDeposits);
  assert.equal(lines.length, 4);
  assert.equal(total, 160000);
});
