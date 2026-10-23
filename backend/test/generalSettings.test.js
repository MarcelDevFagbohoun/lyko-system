'use strict';

/** Réglages généraux déplacés depuis la comptabilité avancée (charges %, commission, seuil d'alerte). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const settingsValidators = require('../src/validators/settings');
const glValidators = require('../src/validators/gl/settings');

const schema = settingsValidators.updateSettingsSchema || settingsValidators.settingsSchema || Object.values(settingsValidators).find((v) => v && typeof v.parse === 'function');

test('réglages généraux — pourcentage de charges, moment de commission, seuil', () => {
  const ok = schema.parse({ utilityPassThroughPercent: '80', commissionTiming: 'reversement', expenseAlertThreshold: '250000' });
  assert.equal(ok.utilityPassThroughPercent, 80);
  assert.equal(ok.commissionTiming, 'reversement');
  assert.equal(ok.expenseAlertThreshold, 250000);
  assert.equal(schema.parse({ expenseAlertThreshold: '' }).expenseAlertThreshold, null);
  assert.throws(() => schema.parse({ utilityPassThroughPercent: 101 }));
  assert.throws(() => schema.parse({ commissionTiming: 'jamais' }));
  assert.throws(() => schema.parse({ expenseAlertThreshold: 0 }));
});

test('réglages comptabilité avancée — ne contiennent plus les réglages déplacés', () => {
  const s = Object.values(glValidators).find((v) => v && typeof v.parse === 'function');
  const parsed = s.parse({ irfEnabled: true, utilityPassThroughPercent: 50, commissionTiming: 'reversement' });
  assert.equal(parsed.utilityPassThroughPercent, undefined);
  assert.equal(parsed.commissionTiming, undefined);
});
