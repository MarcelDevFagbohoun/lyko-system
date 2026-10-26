import { test } from "node:test";
import assert from "node:assert/strict";
import { limitsSummary, planActionLabel, planRelation, remainingRatio } from "../lib/billing-plans.ts";

const KEYS = ["demarrage", "pro", "entreprise"];

test("planRelation : sans abonnement actif, toute offre est « none »", () => {
  for (const k of KEYS) assert.equal(planRelation(KEYS, null, k), "none");
});

test("planRelation : offre actuelle, supérieure, inférieure", () => {
  assert.equal(planRelation(KEYS, "pro", "pro"), "current");
  assert.equal(planRelation(KEYS, "pro", "entreprise"), "upgrade");
  assert.equal(planRelation(KEYS, "pro", "demarrage"), "downgrade");
  assert.equal(planRelation(KEYS, "demarrage", "entreprise"), "upgrade");
});

test("planRelation : clé inconnue (ex. « interne ») → « none », jamais d'exception", () => {
  assert.equal(planRelation(KEYS, "interne", "pro"), "none");
  assert.equal(planRelation(KEYS, "pro", "autre"), "none");
});

test("planActionLabel : un libellé par relation", () => {
  assert.equal(planActionLabel("none", "Pro"), "Choisir Pro");
  assert.equal(planActionLabel("current", "Pro"), "Renouveler");
  assert.equal(planActionLabel("upgrade", "Entreprise"), "Passer à Entreprise");
  assert.equal(planActionLabel("downgrade", "Démarrage"), "Disponible à l'échéance");
});

test("remainingRatio : part du temps restant, bornée entre 0 et 1", () => {
  assert.equal(remainingRatio(60, 4), 0.5);
  assert.equal(remainingRatio(500, 4), 1);
  assert.equal(remainingRatio(-3, 4), 0);
  assert.equal(remainingRatio(null, 4), null);
  assert.equal(remainingRatio(10, null), null);
});

test("limitsSummary : pluriel, singulier et limites absentes", () => {
  assert.equal(limitsSummary({ units: 50, owners: 10, users: 2 }), "50 unités · 10 propriétaires · 2 utilisateurs");
  assert.equal(limitsSummary({ units: 1, owners: 1, users: 1 }), "1 unité · 1 propriétaire · 1 utilisateur");
  assert.equal(limitsSummary({ units: null, owners: null, users: 20 }), "Unités illimitées · Propriétaires illimités · 20 utilisateurs");
});

import { offerPricing } from "../lib/billing-plans.ts";

test("offerPricing : promotion, tarif fondateur et absence de cumul", () => {
  // sans promotion ni fondateur
  assert.deepEqual(offerPricing({ price: 65000, listPrice: 65000 }, null), { price: 65000, strike: null, isFounder: false, isPromo: false });
  // promotion seule : le prix catalogue est barré
  assert.deepEqual(offerPricing({ price: 52000, listPrice: 65000 }, null), { price: 52000, strike: 65000, isFounder: false, isPromo: true });
  // fondateur plus bas que la promotion : il l'emporte
  assert.deepEqual(offerPricing({ price: 52000, listPrice: 65000 }, 49000), { price: 49000, strike: 65000, isFounder: true, isPromo: false });
  // fondateur plus haut que la promotion : la promotion l'emporte
  assert.deepEqual(offerPricing({ price: 45500, listPrice: 65000 }, 49000), { price: 45500, strike: 65000, isFounder: false, isPromo: true });
  // ancien format (sans listPrice)
  assert.deepEqual(offerPricing({ price: 65000 }, 49000), { price: 49000, strike: 65000, isFounder: true, isPromo: false });
});
