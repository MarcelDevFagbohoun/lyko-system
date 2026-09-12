'use strict';

/** Type de fluide facturé au locataire (section 9). */
const UTILITY_TYPES = [
  { key: 'soneb', label: 'SONEB (Eau)' },
  { key: 'sbee', label: 'SBEE (Électricité)' },
];
const UTILITY_TYPE_KEYS = UTILITY_TYPES.map((t) => t.key);

const CHARGE_STATUSES = ['impayee', 'payee'];
const CHARGE_STATUS_LABELS = { impayee: 'Impayée', payee: 'Payée' };

// Relevé par immeuble (étape 9bis) : au-delà de ce ratio (différence compteur
// principal / consommation du compteur principal), on affiche un avertissement
// « fuite / parties communes / relevé à vérifier ».
const DIFFERENCE_ALERT_PCT = 0.15;

module.exports = { UTILITY_TYPES, UTILITY_TYPE_KEYS, CHARGE_STATUSES, CHARGE_STATUS_LABELS, DIFFERENCE_ALERT_PCT };
