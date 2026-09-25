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

// Alertes du suivi des charges (étape 31) — délais de grâce avant qu'une
// situation ne devienne une alerte. Constantes plutôt que réglages : ce sont
// des seuils de confort, pas des règles métier propres à un cabinet.
const UTILITY_ALERT_RULES = {
  /** Jour du mois à partir duquel le relevé du mois précédent est attendu. */
  RELEVE_EXPECTED_FROM_DAY: 5,
  /** Un relevé laissé en brouillon plus longtemps que ça est signalé. */
  DRAFT_BATCH_DAYS: 7,
  /** Délai après validation avant de réclamer la déclaration de la facture mère payée. */
  MAIN_PAYMENT_DAYS: 7,
  /** À partir de combien de jours une facture mère non déclarée devient urgente. */
  MAIN_PAYMENT_URGENT_DAYS: 30,
  /** Charges encaissées non reversées depuis plus de N jours. */
  REMITTANCE_DAYS: 7,
  REMITTANCE_URGENT_DAYS: 30,
  /** Écarts compteur/décompteurs signalés seulement sur les relevés récents. */
  ANOMALY_WINDOW_DAYS: 90,
};

module.exports = {
  UTILITY_ALERT_RULES,
  UTILITY_TYPES,
  UTILITY_TYPE_KEYS,
  CHARGE_STATUSES,
  CHARGE_STATUS_LABELS,
  DIFFERENCE_ALERT_PCT,
  LOSS_ALLOCATION_MODES,
  LOSS_ALLOCATION_LABELS,
};
