'use strict';

/**
 * `computeArrears` — le calcul de retard ne doit jamais remonter avant que
 * Lyko System ne suive réellement le bail (demande directe de l'utilisateur :
 * un locataire entré dans les lieux en 2025 mais enregistré aujourd'hui, à
 * jour, ne doit rien). Fonctions pures, aucune base requise.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeArrears } = require('../src/services/rentTracking');

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
