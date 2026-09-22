'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeMonthlyDepreciation } = require('../../src/services/gl/glDepreciationService');

test('prorataTemporis désactivé (défaut) : toujours un mois plein, même pour le mois d\'acquisition', () => {
  const amount = computeMonthlyDepreciation({
    acquisitionCost: 600000,
    usefulLifeYears: 3,
    acquisitionDate: '2026-01-20',
    period: '2026-01',
    prorataTemporis: false,
  });
  assert.equal(amount, Math.round(600000 / 3 / 12));
});

test("prorataTemporis activé : le mois d'acquisition est proratisé au nombre de jours restants (jour inclus)", () => {
  const monthly = Math.round(600000 / 3 / 12); // 16667
  // Acquis le 20 janvier (31 jours) : 31 - 20 + 1 = 12 jours restants sur 31.
  const amount = computeMonthlyDepreciation({
    acquisitionCost: 600000,
    usefulLifeYears: 3,
    acquisitionDate: '2026-01-20',
    period: '2026-01',
    prorataTemporis: true,
  });
  assert.equal(amount, Math.round((monthly * 12) / 31));
});

test('prorataTemporis activé : les mois SUIVANT le mois d\'acquisition restent des mois pleins', () => {
  const monthly = Math.round(600000 / 3 / 12);
  const amount = computeMonthlyDepreciation({
    acquisitionCost: 600000,
    usefulLifeYears: 3,
    acquisitionDate: '2026-01-20',
    period: '2026-02',
    prorataTemporis: true,
  });
  assert.equal(amount, monthly);
});

test('prorataTemporis activé : une acquisition le 1er du mois donne un mois quasi plein', () => {
  const monthly = Math.round(1200000 / 5 / 12);
  // Acquis le 1er février (28 jours en 2026, non bissextile) : 28 - 1 + 1 = 28 jours sur 28 -> mois plein.
  const amount = computeMonthlyDepreciation({
    acquisitionCost: 1200000,
    usefulLifeYears: 5,
    acquisitionDate: '2026-02-01',
    period: '2026-02',
    prorataTemporis: true,
  });
  assert.equal(amount, monthly);
});

test('prorataTemporis activé : une acquisition le dernier jour du mois donne une toute petite part', () => {
  const monthly = Math.round(900000 / 3 / 12); // 25000
  // Acquis le 30 avril (30 jours) : 30 - 30 + 1 = 1 jour sur 30.
  const amount = computeMonthlyDepreciation({
    acquisitionCost: 900000,
    usefulLifeYears: 3,
    acquisitionDate: '2026-04-30',
    period: '2026-04',
    prorataTemporis: true,
  });
  assert.equal(amount, Math.round((monthly * 1) / 30));
});
