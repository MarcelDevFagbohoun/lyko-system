'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeActivities, parseActivities } = require('../src/utils/activities');
const { updateSettingsSchema } = require('../src/validators/settings');

test('activités : nettoyage, dédoublonnage (casse ignorée) et bornes', () => {
  assert.deepEqual(normalizeActivities([' Gestion  locative ', 'gestion locative', '', 'Conseil']), ['Gestion locative', 'Conseil']);
  assert.equal(normalizeActivities(Array.from({ length: 20 }, (_, i) => `Activité ${i}`)).length, 8);
  assert.equal(normalizeActivities(['x'.repeat(100)])[0].length, 40);
});

test('activités : lecture tolérante d’une valeur corrompue en base', () => {
  assert.deepEqual(parseActivities(null), []);
  assert.deepEqual(parseActivities('pas du json'), []);
  assert.deepEqual(parseActivities('["A1","B2"]'), ['A1', 'B2']);
});

test('réglages : activités acceptées en JSON (multipart) ou tableau, refusées si hors limites', () => {
  assert.deepEqual(updateSettingsSchema.parse({ activities: '["Gestion locative","Conseil"]' }).activities, ['Gestion locative', 'Conseil']);
  assert.deepEqual(updateSettingsSchema.parse({ activities: '' }).activities, []);
  assert.equal(updateSettingsSchema.parse({}).activities, undefined);
  assert.equal(updateSettingsSchema.safeParse({ activities: JSON.stringify(Array.from({ length: 9 }, (_, i) => `Activité ${i}`)) }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ activities: JSON.stringify(['x'.repeat(41)]) }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ activities: JSON.stringify([{ $ne: 1 }]) }).success, false);
});
