'use strict';

/**
 * `meterNumberSchema` (numéro de compteur SONEB/SBEE) — un numéro réel
 * béninois contient en général 14 caractères, mais ce n'est plus bloquant
 * (demande directe de l'utilisateur, 2026-10-17) : certains compteurs réels
 * ne respectent pas cette longueur. Un numéro d'une autre longueur est
 * accepté par le serveur — l'écart est signalé à l'écran (avertissement),
 * jamais en invalidant le formulaire.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createUnitSchema, updateUnitSchema } = require('../../src/validators/properties');

const BASE_UNIT = { designation: 'studio', monthlyRent: 50000 };

test('createUnitSchema — accepte un numéro de compteur d\'exactement 14 caractères', () => {
  const result = createUnitSchema.safeParse({ ...BASE_UNIT, sonebMeterNumber: '12345678901234', sbeeMeterNumber: 'ABCDE6789012Q1' });
  assert.equal(result.success, true);
  assert.equal(result.data.sonebMeterNumber, '12345678901234');
  assert.equal(result.data.sbeeMeterNumber, 'ABCDE6789012Q1');
});

test('createUnitSchema — accepte aussi un numéro de compteur plus court ou plus long (avertissement, pas un blocage)', () => {
  const tooShort = createUnitSchema.safeParse({ ...BASE_UNIT, sonebMeterNumber: '123456789' });
  assert.equal(tooShort.success, true);
  assert.equal(tooShort.data.sonebMeterNumber, '123456789');

  const tooLong = createUnitSchema.safeParse({ ...BASE_UNIT, sonebMeterNumber: '123456789012345678' });
  assert.equal(tooLong.success, true);
  assert.equal(tooLong.data.sonebMeterNumber, '123456789012345678');
});

test("createUnitSchema — absent/vide reste autorisé (compteur non suivi)", () => {
  const absent = createUnitSchema.safeParse({ ...BASE_UNIT });
  assert.equal(absent.success, true);
  assert.equal(absent.data.sonebMeterNumber, null);

  const empty = createUnitSchema.safeParse({ ...BASE_UNIT, sonebMeterNumber: '' });
  assert.equal(empty.success, true);
  assert.equal(empty.data.sonebMeterNumber, null);
});

test('updateUnitSchema — même tolérance de longueur sur un compteur modifié', () => {
  const nonStandard = updateUnitSchema.safeParse({ sbeeMeterNumber: 'trop-court' });
  assert.equal(nonStandard.success, true);
  assert.equal(nonStandard.data.sbeeMeterNumber, 'trop-court');

  const valid = updateUnitSchema.safeParse({ sbeeMeterNumber: '98765432109876' });
  assert.equal(valid.success, true);
  assert.equal(valid.data.sbeeMeterNumber, '98765432109876');
});

test('createUnitSchema — rejette toujours un numéro de compteur déraisonnablement long (garde-fou générique)', () => {
  const result = createUnitSchema.safeParse({ ...BASE_UNIT, sonebMeterNumber: '1'.repeat(31) });
  assert.equal(result.success, false);
});
