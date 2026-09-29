'use strict';

/**
 * Facturation des dégradations à l'état des lieux de sortie (catalogue de
 * prix) — fonctions pures de `services/inspection.js`, aucune base requise.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeItemDeduction,
  recomputeItemDeductions,
  compareCondition,
  cloneMasterZones,
  normalizeStoredItems,
  toPublicInspectionReport,
  toPublicMoveOutReport,
} = require('../src/services/inspection');

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

/**
 * Galerie de photos (étape 48, audit état des lieux) : jusqu'à 3 photos par
 * élément, `photoUrls[]` remplace l'ancien `photoUrl` (singulier).
 */
test('cloneMasterZones — chaque élément démarre avec photoUrls vide, jamais photoUrl', () => {
  const zones = cloneMasterZones();
  const item = zones[0].items[0];
  assert.deepEqual(item.photoUrls, []);
  assert.equal('photoUrl' in item, false);
});

test('normalizeStoredItems — migre une fiche stockée avec l’ancien photoUrl (singulier) vers photoUrls', () => {
  const stored = {
    zones: [
      {
        key: 'chambre',
        label: 'Chambre',
        custom: false,
        items: [{ key: 'porte', label: 'Porte', custom: false, condition: 'BE', comment: null, photoUrl: '/uploads/x.png', deduction: 0 }],
      },
    ],
  };
  const zones = normalizeStoredItems(stored);
  assert.deepEqual(zones[0].items[0].photoUrls, ['/uploads/x.png']);
});

test('normalizeStoredItems — une fiche déjà en photoUrls[] n’est pas altérée', () => {
  const stored = {
    zones: [
      {
        key: 'chambre',
        label: 'Chambre',
        custom: false,
        items: [{ key: 'porte', label: 'Porte', custom: false, condition: 'BE', comment: null, photoUrls: ['/a.png', '/b.png'], deduction: 0 }],
      },
    ],
  };
  const zones = normalizeStoredItems(stored);
  assert.deepEqual(zones[0].items[0].photoUrls, ['/a.png', '/b.png']);
});

test('normalizeStoredItems — ancien format (tableau plat) : photoUrls vide, jamais de photoUrl résiduel', () => {
  const zones = normalizeStoredItems([{ label: 'Porte', condition: 'bon', comment: null }]);
  assert.deepEqual(zones[0].items[0].photoUrls, []);
});

/**
 * Bug corrigé (audit étape 48) : `refundPaymentMethod` était stocké et exigé
 * à la finalisation, mais jamais renvoyé par l'API — ni affiché à l'écran,
 * ni sur le PV signé par les deux parties.
 */
test('toPublicMoveOutReport — expose refundPaymentMethod (bug corrigé, ne disparaît plus)', () => {
  const row = {
    id: 1,
    status: 'finalized',
    conducted_at: '2026-09-29',
    items: { zones: [] },
    general_notes: null,
    tenant_reserves: null,
    other_deductions_amount: 0,
    other_deductions_note: null,
    peinture_deduction_amount: 0,
    peinture_deduction_note: null,
    deposit_amount: 60000,
    total_deductions: 30000,
    net_refund: 30000,
    refund_payment_method: 'mobile_money',
    gl_regularized_at: null,
  };
  const report = toPublicMoveOutReport(row);
  assert.equal(report.refundPaymentMethod, 'mobile_money');
});

/**
 * Réserves du locataire + réouverture (étape 48) : nouveaux champs exposés
 * par la sérialisation publique, commune entrée/sortie.
 */
test('toPublicInspectionReport — expose tenantReserves et l’historique de réouverture', () => {
  const row = {
    id: 1,
    status: 'draft',
    conducted_at: '2026-09-29',
    items: { zones: [] },
    general_notes: null,
    tenant_reserves: "Le locataire conteste l'état du carrelage.",
    reopened_at: new Date('2026-09-29T10:00:00Z'),
    reopener_first_name: 'Audit',
    reopener_last_name: 'DG',
    reopener_role: 'dg',
    reopen_reason: 'Erreur de saisie sur la zone chambre',
  };
  const report = toPublicInspectionReport(row);
  assert.equal(report.tenantReserves, "Le locataire conteste l'état du carrelage.");
  assert.equal(report.reopenReason, 'Erreur de saisie sur la zone chambre');
  assert.equal(report.reopenedBy.name, 'Audit DG');
});
