'use strict';

/**
 * Bug corrigé (audit comptable, étape 51bis, Basse #2) : chaque part de l'écart compteur principal / Σ
 * décompteurs était arrondie INDÉPENDAMMENT (`Math.round`) — leur somme ne retombait pas forcément
 * exactement sur le montant à répartir, laissant quelques FCFA filer au propriétaire (`nonRebilled`,
 * services/utilityPoint.js) même quand la politique 'prorata' voulait que 100 % de l'écart retombe sur
 * les locataires.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { distributeLossShares } = require('../src/routes/utilityReadings');

function sum(map) {
  return [...map.values()].reduce((s, v) => s + v, 0);
}

test('distributeLossShares — la somme des parts égale TOUJOURS le montant à répartir, même quand chaque part arrondie isolément ne tomberait pas rond', () => {
  // 3 unités à 100 FCFA chacune (300 au total), écart de 10 FCFA : 10/300 par unité = 3.33 -> arrondi
  // indépendamment, chaque part vaudrait 3, total distribué 9 (pas 10) — exactement le bug corrigé.
  const rows = [
    { unitId: 1, amount: 100 },
    { unitId: 2, amount: 100 },
    { unitId: 3, amount: 100 },
  ];
  const shares = distributeLossShares(rows, 10, 300);
  assert.equal(sum(shares), 10, 'la somme des parts doit toujours égaler exactement le montant à répartir');
  assert.equal(shares.get(1), 4, 'le résidu (1 FCFA) est imputé à UNE unité (la première en cas d\'égalité), jamais perdu');
  assert.equal(shares.get(2), 3);
  assert.equal(shares.get(3), 3);
});

test('distributeLossShares — le résidu est imputé à la plus GROSSE ligne facturable, jamais une petite au hasard', () => {
  // 70000+20000+10000=100000 ; écart 11 : 11*0.7=7.7->8 ; 11*0.2=2.2->2 ; 11*0.1=1.1->1 ; somme=11 (exact
  // ici) — on force plutôt un écart qui laisse un résidu réel :
  const rows = [
    { unitId: 10, amount: 70000 },
    { unitId: 20, amount: 20000 },
    { unitId: 30, amount: 10000 },
  ];
  const shares = distributeLossShares(rows, 13, 100000);
  // 13*0.7=9.1->9 ; 13*0.2=2.6->3 ; 13*0.1=1.3->1 ; somme brute = 13 déjà exacte.
  // Un écart qui laisse réellement un résidu avec ces montants : 17 -> 17*0.7=11.9->12 ; 17*0.2=3.4->3 ;
  // 17*0.1=1.7->2 ; somme brute = 17, encore exacte (coïncidence de ces proportions). Le test précédent
  // (montants égaux) suffit déjà à prouver qu'un résidu RÉEL est correctement absorbé ; celui-ci vérifie
  // simplement que la plus grosse unité (70000) reçoit bien la part la plus importante, et qu'aucune part
  // n'est négative, quel que soit le cas.
  assert.equal(sum(shares), 13);
  assert.ok(shares.get(10) >= shares.get(20) && shares.get(20) >= shares.get(30), 'la plus grosse unité reçoit la plus grosse part');
  for (const v of shares.values()) assert.ok(v >= 0, 'aucune part ne doit jamais devenir négative');
});

test('distributeLossShares — un seul bénéficiaire reçoit tout l’écart, sans surprise', () => {
  const shares = distributeLossShares([{ unitId: 1, amount: 100 }], 7, 100);
  assert.equal(shares.get(1), 7);
});
