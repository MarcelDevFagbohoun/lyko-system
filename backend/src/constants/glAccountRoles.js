'use strict';

/**
 * Catalogue des `account_role` reconnus par `glAccountResolver` — un rôle
 * symbolique posé sur une ligne de règle (`gl_posting_rule_lines.account_role`)
 * quand le compte réel dépend du CONTEXTE d'exécution (mode de paiement,
 * tiers concerné), jamais d'un compte fixe connu à l'avance.
 */
const GL_ACCOUNT_ROLES = {
  // Résolu via TREASURY_BY_PAYMENT_METHOD (db/seedGeneralLedger.js) à partir
  // du `paymentMethod` de l'opération — mêmes valeurs que les ENUM
  // `payment_method` déjà utilisés dans rent_payments/expenses/etc.
  TRESORERIE_MODE_PAIEMENT: 'tresorerie_mode_paiement',
  // Résolu via `context.leaseId` → renters (compte auxiliaire 411).
  TIERS_LOCATAIRE: 'tiers_locataire',
  // Résolu via `context.ownerId` (ou `context.leaseId` → properties.owner_id)
  // → owners (compte auxiliaire 4671).
  TIERS_PROPRIETAIRE: 'tiers_proprietaire',
  // Cas particulier : coexiste avec un `account_id` FIXE sur la ligne (165 —
  // dépôts et cautionnements reçus). Contrairement à TIERS_LOCATAIRE, qui
  // résout à la fois le compte ET le tiers vers l'auxiliaire habituel du
  // locataire (411), ce rôle attache seulement le TIERS (sous-compte par
  // locataire) au compte 165 déjà fixé par la règle — la caution d'un
  // locataire donné n'est pas la même chose que sa créance de loyer.
  TIERS_LOCATAIRE_CAUTION: 'tiers_locataire_caution',
  // Résolu via `context.supplierId` → suppliers (compte auxiliaire 401).
  TIERS_FOURNISSEUR: 'tiers_fournisseur',
  // Dynamique : trésorerie si `context.paymentMethod` est fourni (dépense
  // réglée immédiatement, comme avant) ; sinon TIERS_FOURNISSEUR (dépense
  // "à crédit", pas encore payée) — une SEULE règle par catégorie de
  // dépense couvre les deux cas plutôt que de doubler les 8 règles
  // `depense_*` existantes.
  TRESORERIE_OU_FOURNISSEUR: 'tresorerie_ou_fournisseur',
  // Même principe que TIERS_LOCATAIRE_CAUTION : le même fournisseur a besoin
  // d'un sous-compte SÉPARÉ de son 401 habituel quand la dette concerne un
  // INVESTISSEMENT (achat d'immobilisation) plutôt qu'un achat courant —
  // SYSCOHADA distingue 401 (fournisseurs d'exploitation) et 481
  // (fournisseurs d'investissements), déjà seedés séparément.
  TIERS_FOURNISSEUR_INVESTISSEMENT: 'tiers_fournisseur_investissement',
  // Dynamique, variante investissement de TRESORERIE_OU_FOURNISSEUR : 481
  // au lieu de 401 côté fournisseur.
  TRESORERIE_OU_FOURNISSEUR_INVESTISSEMENT: 'tresorerie_ou_fournisseur_investissement',
};

const GL_ACCOUNT_ROLE_VALUES = Object.values(GL_ACCOUNT_ROLES);

module.exports = { GL_ACCOUNT_ROLES, GL_ACCOUNT_ROLE_VALUES };
