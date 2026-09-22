'use strict';

/**
 * Catalogue des types d'opération métier reconnus par le moteur comptable —
 * DOIT rester synchronisé avec `gl_posting_rules.operation_type` (une règle
 * par type, voir `db/seedGeneralLedger.js`). Le moteur (`glPostingService`)
 * refuse tout type absent de cette liste : jamais de règle inventée à la
 * volée depuis une route.
 */
const GL_OPERATION_TYPES = [
  'loyer_encaisse',
  'dette_initiale_encaissee',
  'frais_agence_encaisse',
  'charge_locative_encaissee',
  'caution_recue',
  'caution_restituee',
  'reversement_proprietaire',
  'reglement_irf',
  'salaire_paye',
  'penalite_retard',
  'reglement_fournisseur',
  'reglement_fournisseur_investissement',
  'depense_loyer_bureau',
  'depense_fournitures',
  'depense_entretien',
  'depense_transport',
  'depense_communication',
  'depense_marketing',
  'depense_taxes',
  'depense_autre',
  'immobilisation_informatique_acquise',
  'immobilisation_mobilier_acquise',
  'immobilisation_transport_acquise',
  'amortissement_informatique',
  'amortissement_mobilier',
  'amortissement_transport',
];

// Catégorie de `fixed_assets.category` → type d'opération d'ACQUISITION.
const FIXED_ASSET_CATEGORY_TO_ACQUISITION_TYPE = {
  informatique: 'immobilisation_informatique_acquise',
  mobilier: 'immobilisation_mobilier_acquise',
  transport: 'immobilisation_transport_acquise',
};

// Catégorie de `fixed_assets.category` → type d'opération d'AMORTISSEMENT.
const FIXED_ASSET_CATEGORY_TO_DEPRECIATION_TYPE = {
  informatique: 'amortissement_informatique',
  mobilier: 'amortissement_mobilier',
  transport: 'amortissement_transport',
};

// Catégories de `expenses.category` (existant) → type d'opération comptable.
// `salaires` pointe vers la règle DÉDIÉE `salaire_paye` (pas une règle de
// dépense générique) — décision validée avec l'utilisateur.
const EXPENSE_CATEGORY_TO_OPERATION_TYPE = {
  loyer_bureau: 'depense_loyer_bureau',
  salaires: 'salaire_paye',
  fournitures: 'depense_fournitures',
  entretien: 'depense_entretien',
  transport: 'depense_transport',
  communication: 'depense_communication',
  marketing: 'depense_marketing',
  taxes: 'depense_taxes',
  autre: 'depense_autre',
};

// Types réellement appelés par une route métier existante (leases.js,
// charges.js, accounting.js via EXPENSE_CATEGORY_TO_OPERATION_TYPE,
// owners.js, renters.js pour la caution) — désactiver une de ces règles
// ferait échouer l'opération MÉTIER elle-même (paiement, dépense,
// versement, création de bail, pénalité, règlement fournisseur), pas
// seulement son écriture comptable, puisque `genererEcriture` s'exécute
// dans la même transaction SQL (exigence explicite du cahier des charges).
// Toutes les règles sont désormais réellement branchées — aucune exclusion.
const GL_CORE_HOOKED_OPERATION_TYPES = [...GL_OPERATION_TYPES];

module.exports = {
  GL_OPERATION_TYPES,
  EXPENSE_CATEGORY_TO_OPERATION_TYPE,
  FIXED_ASSET_CATEGORY_TO_ACQUISITION_TYPE,
  FIXED_ASSET_CATEGORY_TO_DEPRECIATION_TYPE,
  GL_CORE_HOOKED_OPERATION_TYPES,
};
