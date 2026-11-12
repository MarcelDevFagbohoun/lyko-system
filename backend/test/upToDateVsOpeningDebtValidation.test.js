'use strict';

/**
 * Garde-fou serveur manquant, trouvé à l'audit du 2026-11-12 : rien n'empêchait d'envoyer
 * `upToDateAtOnboarding: true` EN MÊME TEMPS qu'un impayé de loyer déclaré à l'entrée — seul le
 * formulaire (frontend, use-new-renter-form.ts) décochait/masquait la case. Un appel API direct
 * passait sans erreur, créant un bail "à jour" sur son loyer ET avec un loyer impayé affiché au
 * Centre de relance en même temps — état de données contradictoire. Voir
 * `validators/renters.js` `forbidUpToDateWithLoyerOpeningDebt`. Test unitaire pur (aucune base de
 * données nécessaire) : passe directement les schémas Zod exportés.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRenterSchema, createLeaseSchema } = require('../src/validators/renters');

const BASE = {
  firstName: 'Jean',
  lastName: 'Dupont',
  phone: '0161234567',
  unitId: 1,
  startDate: '2026-01-01',
};

test('createRenterSchema — rejette upToDateAtOnboarding=true avec un poste loyer impayé détaillé', () => {
  const result = createRenterSchema.safeParse({
    ...BASE,
    upToDateAtOnboarding: true,
    openingDebtItems: [{ debtType: 'loyer', periodMonth: monthsAgo(1), amount: 50000 }],
  });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((i) => i.path.join('.') === 'upToDateAtOnboarding');
  assert.ok(issue, "une erreur doit cibler upToDateAtOnboarding");
});

test('createRenterSchema — rejette upToDateAtOnboarding=true avec un openingDebtAmount global (ancien format sans détail)', () => {
  const result = createRenterSchema.safeParse({
    ...BASE,
    upToDateAtOnboarding: true,
    openingDebtAmount: 30000,
  });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((i) => i.path.join('.') === 'upToDateAtOnboarding');
  assert.ok(issue);
});

test("createRenterSchema — accepte upToDateAtOnboarding=true si le seul impayé détaillé est d'un AUTRE type (SBEE)", () => {
  const result = createRenterSchema.safeParse({
    ...BASE,
    upToDateAtOnboarding: true,
    openingDebtItems: [{ debtType: 'sbee', periodMonth: monthsAgo(1), amount: 10000 }],
  });
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
});

test('createRenterSchema — accepte upToDateAtOnboarding=true sans aucun impayé déclaré (comportement historique inchangé)', () => {
  const result = createRenterSchema.safeParse({ ...BASE, upToDateAtOnboarding: true });
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
});

test('createLeaseSchema — même garde-fou pour un nouveau bail sur un locataire existant', () => {
  const result = createLeaseSchema.safeParse({
    unitId: 1,
    startDate: '2026-01-01',
    upToDateAtOnboarding: true,
    openingDebtItems: [{ debtType: 'loyer', periodMonth: monthsAgo(1), amount: 50000 }],
  });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((i) => i.path.join('.') === 'upToDateAtOnboarding');
  assert.ok(issue);
});

// Un mois dans les 12 derniers mois, jamais le mois en cours (même fenêtre que le validateur).
function monthsAgo(n) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
