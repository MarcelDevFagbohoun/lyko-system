'use strict';

/**
 * Catalogue des permissions assignables par le DG à un employé (section 5).
 * Le DG a toujours accès à tout (contrôlé par le rôle, pas par cette table) ;
 * ce catalogue ne s'applique qu'aux rôles 'comptable' et 'agent'.
 *
 * Les clés correspondent aux modules du cahier des charges — la plupart de
 * ces modules n'existent pas encore (ils arrivent aux étapes 4+) : assigner
 * une permission aujourd'hui prépare simplement les accès de l'employé pour
 * quand le module sera construit.
 */
const PERMISSIONS = [
  { key: 'locataires', label: 'Locataires' },
  { key: 'proprietaires', label: 'Propriétaires' },
  { key: 'etats_des_lieux', label: 'États des lieux & sorties' },
  { key: 'plaintes', label: 'Plaintes & réclamations' },
  { key: 'comptabilite', label: 'Comptabilité & finances' },
  { key: 'charges', label: 'Charges & redevances (SONEB/SBEE)' },
  { key: 'documents_juridiques', label: 'Actes & baux' },
  // Module comptabilité SYSCOHADA (nouveau) : distincte de `comptabilite`
  // (saisie simple, formulaires en langage courant — "Encaisser un loyer",
  // "Enregistrer une dépense") — cette permission-ci donne accès à l'espace
  // « Comptabilité avancée » (grand livre, balance, écritures, clôture
  // d'exercice, extourne). Un profil « Secrétaire » a `comptabilite` sans
  // `comptabilite_avancee` ; un profil « Comptable » a les deux.
  { key: 'comptabilite_avancee', label: 'Comptabilité avancée (SYSCOHADA)' },
  // Assistant IA (chat Claude). Ne s'applique que si la direction a activé l'assistant pour
  // l'entreprise (Réglages) ; jamais pré-cochée à la création d'un employé.
  { key: 'assistant', label: 'Assistant IA' },
  // Biens à vendre (demande utilisateur, 2026-10-18) : catalogue interne des maisons/terrains que le
  // cabinet est chargé de vendre — jamais pré-cochée à la création d'un employé (accès volontairement
  // restreint, accordé au cas par cas par le DG).
  { key: 'biens_a_vendre', label: 'Biens à vendre' },
  // Actions sensibles (demande utilisateur, 2026-10-26) : avoir accès à une fiche ne permet PAS de
  // faire circuler de l'argent. Chaque opération financière a sa propre permission, à accorder une à une.
  { key: 'loyers_encaisser', label: 'Enregistrer des versements de locataires (loyers, cautions, pénalités)', group: 'operations' },
  { key: 'reversements_proprietaires', label: 'Enregistrer des versements aux propriétaires', group: 'operations' },
  { key: 'charges_enregistrer', label: 'Enregistrer et régler des charges (SONEB/SBEE)', group: 'operations' },
  { key: 'depenses_enregistrer', label: 'Enregistrer des dépenses, des recettes et des immobilisations', group: 'operations' },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Pré-cochées à la création selon le rôle choisi (section 5, exemples donnés) —
// le DG peut les ajuster librement avant de valider.
// Le « profil d'accès » n'existe plus à la création (2026-10-26) : le DG coche lui-même, rien n'est
// pré-coché. Ces valeurs ne servent plus qu'aux anciens clients qui enverraient encore un rôle.
const DEFAULT_PERMISSIONS_BY_ROLE = {
  agent: [],
  comptable: [],
};

module.exports = { PERMISSIONS, PERMISSION_KEYS, DEFAULT_PERMISSIONS_BY_ROLE };
