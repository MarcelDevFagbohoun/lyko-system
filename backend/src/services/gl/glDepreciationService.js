'use strict';

/**
 * Calcul du montant d'amortissement d'UN mois — extrait en fonction pure
 * (aucun accès DB) pour être testable directement, et pour que
 * `routes/accounting.js` n'ait qu'à l'appeler avec les valeurs déjà
 * chargées. Amortissement LINÉAIRE simple (coût ÷ durée de vie ÷ 12) —
 * toujours une saisie MANUELLE, jamais automatique (un clic par mois par
 * immobilisation, voir la table `fixed_asset_depreciations`).
 */

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * `prorataTemporis` (réglage par entreprise, `tenants.gl_depreciation_prorata_temporis`) :
 * si actif, SEUL le mois d'ACQUISITION est proratisé au nombre de jours
 * restants dans ce mois — JOUR D'ACQUISITION INCLUS (convention choisie ;
 * une autre serait tout aussi défendable — hypothèse à valider par un
 * expert-comptable). Tous les mois suivants restent des mois pleins,
 * jusqu'au plafond de la valeur nette restante (géré par l'appelant, voir
 * `remainingBookValue` dans routes/accounting.js).
 */
function computeMonthlyDepreciation({ acquisitionCost, usefulLifeYears, acquisitionDate, period, prorataTemporis }) {
  const monthly = Math.round(acquisitionCost / usefulLifeYears / 12);
  const acquisitionPeriod = acquisitionDate.slice(0, 7);
  if (!prorataTemporis || period !== acquisitionPeriod) {
    return monthly;
  }

  const [y, m, d] = acquisitionDate.split('-').map(Number);
  const totalDays = daysInMonth(y, m);
  const daysRemaining = totalDays - d + 1;
  return Math.round((monthly * daysRemaining) / totalDays);
}

module.exports = { computeMonthlyDepreciation };
