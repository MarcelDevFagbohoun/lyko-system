'use strict';

/** Type de fluide facturé au locataire (section 9). */
const UTILITY_TYPES = [
  { key: 'soneb', label: 'SONEB (Eau)' },
  { key: 'sbee', label: 'SBEE (Électricité)' },
];
const UTILITY_TYPE_KEYS = UTILITY_TYPES.map((t) => t.key);

const CHARGE_STATUSES = ['impayee', 'partiellement_payee', 'payee'];
const CHARGE_STATUS_LABELS = { impayee: 'Impayée', partiellement_payee: 'Partiellement payée', payee: 'Payée' };

// Relevé par immeuble (étape 9bis) : au-delà de ce ratio (différence compteur
// principal / consommation du compteur principal), on affiche un avertissement
// « fuite / parties communes / relevé à vérifier ».
const DIFFERENCE_ALERT_PCT = 0.15;

// Répartition de l'écart compteur principal / Σ décompteurs (étape 23) — par
// défaut à la charge du propriétaire (comportement d'origine, jamais changé
// sans action explicite du DG sur ce Bien précis).
const LOSS_ALLOCATION_MODES = ['proprietaire', 'prorata'];
const LOSS_ALLOCATION_LABELS = {
  proprietaire: 'À la charge du propriétaire',
  prorata: 'Répartie entre les locataires (au prorata)',
};

module.exports = {
  UTILITY_TYPES,
  UTILITY_TYPE_KEYS,
  CHARGE_STATUSES,
  CHARGE_STATUS_LABELS,
  DIFFERENCE_ALERT_PCT,
  LOSS_ALLOCATION_MODES,
  LOSS_ALLOCATION_LABELS,
};
