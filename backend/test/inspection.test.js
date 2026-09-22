'use strict';

/**
 * Facturation des dégradations à l'état des lieux de sortie (catalogue de
 * prix) — fonctions pures de `services/inspection.js`, aucune base requise.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeItemDeduction, recomputeItemDeductions, compareCondition } = require('../src/services/inspection');

test('computeItemDeduction — sans ligne de facturation, garde le montant libre existant', () => {
  const item = { deduction: 12000, billing: null };
  assert.equal(computeItemDeduction(item), 12000);
});

test('computeItemDeduction — une ligne de facturation (prix unitaire × quantité)', () => {
  const item = { deduction: 0, billing: { lines: [{ label: 'Vitre', unitPrice: 5000, quantity: 2 }] } };
  assert.equal(computeItemDeduction(item), 10000);
});

test('computeItemDeduction — plusieurs lignes, sommées, ignore le champ libre même non nul', () => {
  const item = {
    deduction: 999999, // doit être ignoré : les lignes font foi dès qu'il y en a au moins une
    billing: {
      lines: [
        { label: 'Porte', unitPrice: 15000, quantity: 1 },
        { label: "Poignée", unitPrice: 2000, quantity: 1 },
      ],
    },
  };
  assert.equal(computeItemDeduction(item), 17000);
});

test('computeItemDeduction — billing.lines vide se comporte comme "sans ligne"', () => {
  const item = { deduction: 3000, billing: { lines: [] } };
  assert.equal(computeItemDeduction(item), 3000);
});

test('recomputeItemDeductions — met à jour item.deduction en place sur toutes les zones', () => {
  const zones = [
    {
      key: 'chambre',
      items: [
        { key: 'porte', deduction: 0, billing: { lines: [{ label: 'Porte', unitPrice: 15000, quantity: 1 }] } },
        { key: 'fenetre', deduction: 4000, billing: null },
      ],
    },
  ];
  recomputeItemDeductions(zones);
  assert.equal(zones[0].items[0].deduction, 15000);
  assert.equal(zones[0].items[1].deduction, 4000);
});

test('compareCondition — dégradation, amélioration, identique, non renseigné', () => {
  assert.equal(compareCondition('BE', 'ME'), 'degraded');
  assert.equal(compareCondition('BE', 'SR'), 'degraded');
  assert.equal(compareCondition('ME', 'BE'), 'improved');
  assert.equal(compareCondition('SR', 'SR'), 'same');
  assert.equal(compareCondition(null, 'ME'), 'unrated');
  assert.equal(compareCondition('BE', null), 'unrated');
});
