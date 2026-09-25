'use strict';

/**
 * Convention de paiement du loyer — deux pratiques réelles et distinctes
 * chez les agences immobilières béninoises (demande directe de
 * l'utilisateur, 2026-09-24) :
 *   - 'avance' : le loyer du mois M se paie DANS le mois M (ex. le 5),
 *     avant/pendant que le locataire l'habite — comportement historique
 *     du système, resté le défaut.
 *   - 'terme_echu' : le loyer du mois M ne se paie qu'APRÈS, dans les
 *     premiers jours du mois M+1 — l'échéance doit alors être calculée sur
 *     le mois SUIVANT celui facturé (voir `computeArrears`/`isPaymentLate`,
 *     services/rentTracking.js), pas sur le mois lui-même.
 *
 * Réglable par bail (`leases.rent_timing`), avec un défaut par entreprise
 * (`tenants.default_rent_timing`) qui pré-remplit chaque nouveau bail —
 * une agence a en général une seule politique, mais certains propriétaires
 * gérés peuvent avoir leur propre habitude antérieure à Lyko System.
 */
const RENT_TIMINGS = [
  { key: 'avance', label: "Payé d'avance (dans le mois facturé)" },
  { key: 'terme_echu', label: 'Payé à terme échu (après le mois facturé)' },
];
const RENT_TIMING_KEYS = RENT_TIMINGS.map((t) => t.key);

module.exports = { RENT_TIMINGS, RENT_TIMING_KEYS };
