'use strict';

/**
 * `computeArrears` — le calcul de retard ne doit jamais remonter avant que
 * Lyko System ne suive réellement le bail (demande directe de l'utilisateur :
 * un locataire entré dans les lieux en 2025 mais enregistré aujourd'hui, à
 * jour, ne doit rien). Fonctions pures, aucune base requise.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeArrears, allocateRentPayment } = require('../src/services/rentTracking');

const TODAY = new Date('2026-09-22T00:00:00Z');

test('computeArrears — sans createdAt (compatibilité) : comportement historique inchangé', () => {
  // Bail entré en 2025, aucun paiement enregistré, pas de createdAt fourni
  // : doit tout devoir depuis 2025 (comportement d'avant ce correctif).
  const arrears = computeArrears(
    { startDate: '2025-01-01', rentDueDay: 5, payments: [] },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2025-01');
  assert.equal(arrears.status, 'late');
});

test("computeArrears — createdAt postérieur à startDate : plafonne au mois d'enregistrement (le vrai bug corrigé)", () => {
  // Même bail (entré en 2025), mais enregistré sur la plateforme le
  // 2026-09-10 : ne doit RIEN pour les 20 mois passés, seulement à partir
  // du mois d'enregistrement.
  const arrears = computeArrears(
    { startDate: '2025-01-01', createdAt: '2026-09-10', rentDueDay: 5, payments: [] },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-09');
  // Échéance du 5 septembre déjà passée (aujourd'hui le 22) : en retard de
  // CE seul mois, jamais des 20 précédents.
  assert.equal(arrears.status, 'late');
  assert.equal(arrears.monthsLate, 0);
  assert.ok(arrears.daysLate > 0 && arrears.daysLate < 31);
});

test("computeArrears — upToDateAtOnboarding : couvre aussi le mois d'enregistrement lui-même", () => {
  const arrears = computeArrears(
    { startDate: '2025-01-01', createdAt: '2026-09-10', upToDateAtOnboarding: true, rentDueDay: 5, payments: [] },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-10', "le mois d'enregistrement (septembre) est aussi couvert");
  assert.equal(arrears.status, 'current');
});

test('computeArrears — createdAt antérieur à startDate (bail signé en avance) : startDate reste le plafond', () => {
  // Bail signé aujourd'hui pour une entrée le mois prochain : le loyer
  // n'est dû qu'à partir de l'entrée réelle, jamais avant.
  const arrears = computeArrears(
    { startDate: '2026-10-01', createdAt: '2026-09-22', rentDueDay: 5, payments: [] },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-10');
  assert.equal(arrears.status, 'current');
});

test('computeArrears — un vrai paiement après la date de plafond avance nextDueMonth normalement', () => {
  const arrears = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      payments: [{ coversMonth: '2026-09' }],
    },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-10');
  assert.equal(arrears.status, 'current');
});

// Audit comptable du 23/09/2026, anomalie A1 : un paiement PARTIEL ne doit
// JAMAIS faire avancer nextDueMonth comme un paiement complet — sans
// `monthlyRent`, c'était pourtant exactement ce qui se produisait (voir les
// tests "compatibilité" ci-dessus, qui reproduisent volontairement l'ancien
// comportement en omettant `monthlyRent`).

test("computeArrears — AVEC monthlyRent : un paiement partiel (40000/100000) ne libère PAS le mois", () => {
  const arrears = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      monthlyRent: 100000,
      payments: [{ coversMonth: '2026-09', amount: 40000 }],
    },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-09', 'le mois partiellement payé reste dû, pas le mois suivant');
  assert.equal(arrears.paidForNextDueMonth, 40000);
  assert.equal(arrears.status, 'late');
});

test('computeArrears — AVEC monthlyRent : plusieurs paiements partiels du MÊME mois se cumulent avant de libérer le mois suivant', () => {
  const arrearsPartiel = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      monthlyRent: 100000,
      payments: [
        { coversMonth: '2026-09', amount: 40000 },
        { coversMonth: '2026-09', amount: 59999 },
      ],
    },
    TODAY,
  );
  assert.equal(arrearsPartiel.nextDueMonth, '2026-09', "99999 < 100000 : encore dû d'1 FCFA");

  const arrearsComplet = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      monthlyRent: 100000,
      payments: [
        { coversMonth: '2026-09', amount: 40000 },
        { coversMonth: '2026-09', amount: 60000 },
      ],
    },
    TODAY,
  );
  assert.equal(arrearsComplet.nextDueMonth, '2026-10', 'cumul exact du loyer : le mois est enfin libéré');
  assert.equal(arrearsComplet.status, 'current');
});

test('computeArrears — AVEC monthlyRent : un paiement PLEIN se comporte exactement comme avant', () => {
  const arrears = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      monthlyRent: 100000,
      payments: [{ coversMonth: '2026-09', amount: 100000 }],
    },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-10');
  assert.equal(arrears.paidForNextDueMonth, 0);
  assert.equal(arrears.status, 'current');
});

test("computeArrears — `monthlyRent` omis (compatibilité) : ancien comportement buggé volontairement conservé", () => {
  // Un appelant pas encore mis à jour ne doit jamais planter — juste
  // retomber sur l'ancien calcul (déjà couvert par le test ci-dessus qui
  // omet monthlyRent), documenté ici explicitement pour le cas partiel.
  const arrears = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      payments: [{ coversMonth: '2026-09', amount: 40000 }],
    },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-10', 'sans monthlyRent, une ligne partielle libère quand même le mois (ancien comportement)');
});

test("allocateRentPayment — complète d'abord le reliquat d'un mois déjà partiel avant d'attaquer le mois suivant", () => {
  // Mois de septembre déjà réglé à 40000/100000 ; un nouveau paiement de
  // 60000 doit compléter EXACTEMENT septembre, sans créer octobre.
  const result = allocateRentPayment({
    nextDueMonth: '2026-09',
    monthlyRent: 100000,
    alreadyPaidForNextDueMonth: 40000,
    amount: 60000,
  });
  assert.deepEqual(result.allocations, [{ coversMonth: '2026-09', amount: 60000, isPartial: false }]);
});

test('allocateRentPayment — complète le reliquat ET couvre un mois plein supplémentaire', () => {
  // 40000 déjà réglés en septembre ; le locataire paie 160000 : 60000
  // complètent septembre, 100000 couvrent octobre intégralement.
  const result = allocateRentPayment({
    nextDueMonth: '2026-09',
    monthlyRent: 100000,
    alreadyPaidForNextDueMonth: 40000,
    amount: 160000,
  });
  assert.deepEqual(result.allocations, [
    { coversMonth: '2026-09', amount: 60000, isPartial: false },
    { coversMonth: '2026-10', amount: 100000, isPartial: false },
  ]);
});

test("allocateRentPayment — un nouveau paiement encore insuffisant pour le reliquat reste sur le même mois", () => {
  const result = allocateRentPayment({
    nextDueMonth: '2026-09',
    monthlyRent: 100000,
    alreadyPaidForNextDueMonth: 40000,
    amount: 30000,
  });
  assert.deepEqual(result.allocations, [{ coversMonth: '2026-09', amount: 30000, isPartial: true }]);
});

test('allocateRentPayment — sans reliquat (mois neuf), comportement identique à avant ce correctif', () => {
  const result = allocateRentPayment({ nextDueMonth: '2026-09', monthlyRent: 100000, amount: 250000 });
  assert.deepEqual(result.allocations, [
    { coversMonth: '2026-09', amount: 100000, isPartial: false },
    { coversMonth: '2026-10', amount: 100000, isPartial: false },
    { coversMonth: '2026-11', amount: 50000, isPartial: true },
  ]);
});
