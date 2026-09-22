'use strict';

/**
 * Comptes SYSTÈME dont le NUMÉRO reste une hypothèse comptable ouverte (voir
 * migration 050, `gl_accounts.system_key`) — le DG peut les renommer une
 * fois l'avis de son propre expert-comptable obtenu. Toute autre
 * modification (libellé, type, suppression) reste interdite, comme pour
 * n'importe quel compte système.
 */
const RENAMEABLE_SYSTEM_ACCOUNTS = [
  {
    key: 'owner_control_account',
    label: 'Propriétaires mandants',
    defaultCode: '4671',
    hint: "SYSCOHADA ne prévoit pas de compte officiel dédié au mandat de gestion locative — certains cabinets utilisent 4671, d'autres un compte 46 « Associés ».",
  },
  {
    key: 'late_fee_income_account',
    label: 'Pénalités de retard',
    defaultCode: '707',
    hint: '707 « Produits accessoires » par défaut — 758 « Produits divers » est une alternative courante.',
  },
];
const RENAMEABLE_SYSTEM_KEYS = RENAMEABLE_SYSTEM_ACCOUNTS.map((a) => a.key);

module.exports = { RENAMEABLE_SYSTEM_ACCOUNTS, RENAMEABLE_SYSTEM_KEYS };
