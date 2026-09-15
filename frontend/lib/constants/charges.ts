import type { UtilityType, ChargeStatus, BatchStatus, DifferenceAlert, LossAllocation } from "@/lib/api/charges";

/** Miroir de backend/src/constants/charges.js pour l'affichage côté client. */
export const UTILITY_TYPE_LABELS: Record<UtilityType, string> = {
  soneb: "SONEB (Eau)",
  sbee: "SBEE (Électricité)",
};

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  impayee: "Impayée",
  partiellement_payee: "Partiellement payée",
  payee: "Payée",
};

export const LOSS_ALLOCATION_LABELS: Record<LossAllocation, string> = {
  proprietaire: "À la charge du propriétaire",
  prorata: "Répartie entre les locataires (au prorata)",
};

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  brouillon: "Brouillon",
  valide: "Validé",
};

/** Seuil au-delà duquel la différence compteur/décompteur déclenche un avertissement (miroir DIFFERENCE_ALERT_PCT). */
export const DIFFERENCE_ALERT_PCT = 0.15;

export const DIFFERENCE_ALERT_TEXT: Record<Exclude<DifferenceAlert, "none">, string> = {
  high: "La différence dépasse 15 % de la consommation du compteur principal : vérifiez une fuite, les parties communes ou un relevé erroné.",
  negative: "Incohérence : les décompteurs totalisent plus que le compteur principal. Reprenez les index.",
};
