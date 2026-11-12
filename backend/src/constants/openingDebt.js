'use strict';

/**
 * Détail des impayés déclarés à l'entrée d'un locataire déjà en place avant l'utilisation de
 * Africa Immo Management (demande utilisateur, 2026-11-12) — remplace, pour les nouveaux baux, le
 * simple montant total unique (`leases.opening_debt_amount`, toujours alimenté en somme des postes
 * pour rester compatible avec tout ce qui lit déjà cette colonne : comptabilité, commissions, suivi
 * des retards — voir migration 151). Un poste = un type + un mois (AAAA-MM) + un montant.
 *
 * - `loyer` : montant suggéré = loyer mensuel du bail, modifiable poste par poste.
 * - `sbee`/`soneb`/`poubelle`/`autre` : aucun montant suggéré, toujours saisi à la main (les
 *   factures varient d'un mois à l'autre, contrairement au loyer).
 */
const OPENING_DEBT_TYPES = [
  { key: 'loyer', label: 'Loyer' },
  { key: 'sbee', label: 'Facture SBEE (électricité)' },
  { key: 'soneb', label: 'Facture SONEB (eau)' },
  { key: 'poubelle', label: 'Frais de poubelle' },
  { key: 'autre', label: 'Autres' },
];
const OPENING_DEBT_TYPE_KEYS = OPENING_DEBT_TYPES.map((t) => t.key);
const OPENING_DEBT_TYPE_LABELS = Object.fromEntries(OPENING_DEBT_TYPES.map((t) => [t.key, t.label]));

// Limite du sélecteur de mois côté formulaire (demande utilisateur : 12 derniers mois) — reprise ici
// pour que le serveur refuse tout mois hors de cette fenêtre, pas seulement le front.
const OPENING_DEBT_MONTHS_BACK = 12;

module.exports = {
  OPENING_DEBT_TYPES,
  OPENING_DEBT_TYPE_KEYS,
  OPENING_DEBT_TYPE_LABELS,
  OPENING_DEBT_MONTHS_BACK,
};
