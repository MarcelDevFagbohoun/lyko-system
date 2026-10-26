'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clampIsoDate } = require('../src/utils/dates');

test('clampIsoDate : date valide inchangée', () => {
  assert.equal(clampIsoDate('2026-03-31'), '2026-03-31');
  assert.equal(clampIsoDate('2026-04-30'), '2026-04-30');
  assert.equal(clampIsoDate('2028-02-29'), '2028-02-29');
});

test('clampIsoDate : jour au-delà de la fin du mois ramené au dernier jour (mois de moins de 31 jours)', () => {
  assert.equal(clampIsoDate('2026-04-31'), '2026-04-30');
  assert.equal(clampIsoDate('2026-06-31'), '2026-06-30');
  assert.equal(clampIsoDate('2026-02-31'), '2026-02-28');
  assert.equal(clampIsoDate('2028-02-31'), '2028-02-29');
  assert.equal(clampIsoDate('2026-11-99'), '2026-11-30');
});

test('clampIsoDate : tout ce qui n’est pas une date devient « pas de filtre »', () => {
  for (const bad of ['', undefined, null, 42, 'abc', '2026-13-01', '2026-00-10', '2026-04-00', '2026-4-1', "2026-04-01'; DROP TABLE x;--"]) {
    assert.equal(clampIsoDate(bad), '', String(bad));
  }
});

require('../src/utils/zodFr');
const { z } = require('zod');
test('zod 4 : messages par défaut en français, messages explicites conservés', () => {
  const schema = z.object({
    a: z.string(),
    n: z.number(),
    e: z.enum(['x', 'y'], { error: 'Type invalide' }),
    f: z.enum(['x', 'y']),
    s: z.string().min(3, 'Trop court'),
  });
  const err = schema.safeParse({ n: 'q', e: 'z', f: 'z', s: 'a' }).error.flatten().fieldErrors;
  assert.deepEqual(err.a, ['Champ requis']);
  assert.deepEqual(err.n, ['Valeur invalide']);
  assert.deepEqual(err.e, ['Type invalide']);
  assert.deepEqual(err.f, ['Valeur non autorisée']);
  assert.deepEqual(err.s, ['Trop court']);
});
