/** Miroir de backend/src/constants/glRenameableAccounts.js pour l'affichage côté client. */
export const RENAMEABLE_SYSTEM_ACCOUNTS = [
  {
    key: "owner_control_account",
    label: "Propriétaires mandants",
    defaultCode: "4671",
    hint: "SYSCOHADA ne prévoit pas de compte officiel dédié au mandat de gestion locative — certains cabinets utilisent 4671, d'autres un compte 46 « Associés ».",
  },
  {
    key: "late_fee_income_account",
    label: "Pénalités de retard",
    defaultCode: "707",
    hint: "707 « Produits accessoires » par défaut — 758 « Produits divers » est une alternative courante.",
  },
] as const;
