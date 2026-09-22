'use strict';

/**
 * `meterNumberSchema` (numéro de compteur SONEB/SBEE) — indication directe
 * de l'utilisateur (2026-09-22) : un numéro réel béninois contient EXACTEMENT
 * 14 caractères. Optionnel (une unité peut ne pas avoir son compteur suivi),
 * mais s'il est renseigné, la longueur doit être exacte.
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

test('createUnitSchema — rejette un numéro de compteur trop court ou trop long', () => {
  const tooShort = createUnitSchema.safeParse({ ...BASE_UNIT, sonebMeterNumber: '123456789' });
  assert.equal(tooShort.success, false);
  assert.match(tooShort.error.issues[0].message, /14 caractères/);

  const tooLong = createUnitSchema.safeParse({ ...BASE_UNIT, sonebMeterNumber: '123456789012345678' });
  assert.equal(tooLong.success, false);
});

test("createUnitSchema — absent/vide reste autorisé (compteur non suivi)", () => {
  const absent = createUnitSchema.safeParse({ ...BASE_UNIT });
  assert.equal(absent.success, true);
  assert.equal(absent.data.sonebMeterNumber, null);

  const empty = createUnitSchema.safeParse({ ...BASE_UNIT, sonebMeterNumber: '' });
  assert.equal(empty.success, true);
  assert.equal(empty.data.sonebMeterNumber, null);
});

test('updateUnitSchema — même contrôle de longueur exacte sur un compteur modifié', () => {
  const invalid = updateUnitSchema.safeParse({ sbeeMeterNumber: 'trop-court' });
  assert.equal(invalid.success, false);

  const valid = updateUnitSchema.safeParse({ sbeeMeterNumber: '98765432109876' });
  assert.equal(valid.success, true);
  assert.equal(valid.data.sbeeMeterNumber, '98765432109876');
});
