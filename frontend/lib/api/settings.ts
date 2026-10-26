import { apiFetch } from "./client";
import type { RoleTitles } from "@/lib/auth/auth-context";
import type { RentTiming } from "./renters";

export type RoleTitlePresets = { dg: string[]; comptable: string[]; agent: string[] };

export type TenantSettings = {
  /** Activités de l'entreprise, affichées dans l'en-tête des documents (liste à puces sous RCCM/IFU). */
  activities: string[];
  stampUrl: string | null;
  signatureUrl: string | null;
  roleTitles: RoleTitles;
  roleTitlePresets: RoleTitlePresets;
  /** Paiements sortants FedaPay (salaires, reversements, paiements libres). La clé secrète n'est jamais renvoyée. */
  fedapayEnabled: boolean;
  fedapaySandbox: boolean;
  fedapayConfigured: boolean;
  /** Encaissement en ligne (loyers, charges) via FedaPay. */
  fedapayCollectEnabled: boolean;
  fedapayWebhookConfigured: boolean;
  paymentsPerOrderLimit: number;
  paymentsDailyLimit: number;
  /** Pré-remplit la convention de paiement du loyer de chaque nouveau bail. */
  defaultRentTiming: RentTiming;
  /** Pré-remplit le choix de prorata d'entrée de chaque nouveau bail (étape 42). */
  defaultEntryProration: "aucun" | "prorata";
  /** Cautions supplémentaires activées par cette entreprise (étape 43) — désactivées par défaut. */
  depositSbeeEnabled: boolean;
  depositSonebEnabled: boolean;
  depositPeintureEnabled: boolean;
  /** Module Charges (SONEB/SBEE) activé ou non pour cette entreprise. */
  chargesEnabled: boolean;
  /** Part des charges SONEB/SBEE répercutée au locataire (le reste est gardé comme frais de gestion). */
  utilityPassThroughPercent: number;
  /** Moment où la commission de l'entreprise est constatée. */
  commissionTiming: "encaissement" | "reversement";
  /** Seuil d'alerte sur les grosses dépenses (FCFA), null = aucune alerte. */
  expenseAlertThreshold: number | null;
};

export function getSettings(accessToken: string) {
  return apiFetch<{ settings: TenantSettings }>("/api/settings", { accessToken });
}

export function updateSettings(
  accessToken: string,
  input: {
    stamp?: File;
    signature?: File;
    activities?: string[];
    dgTitle?: string;
    comptableTitle?: string;
    agentTitle?: string;
    fedapayEnabled?: boolean;
    fedapaySandbox?: boolean;
    fedapaySecretKey?: string;
    fedapayCollectEnabled?: boolean;
    fedapayWebhookSecret?: string;
    paymentsPerOrderLimit?: number;
    paymentsDailyLimit?: number;
    defaultRentTiming?: RentTiming;
    defaultEntryProration?: "aucun" | "prorata";
    depositSbeeEnabled?: boolean;
    depositSonebEnabled?: boolean;
    depositPeintureEnabled?: boolean;
    chargesEnabled?: boolean;
    utilityPassThroughPercent?: number;
    commissionTiming?: "encaissement" | "reversement";
    /** null = supprimer le seuil. */
    expenseAlertThreshold?: number | null;
  },
) {
  const fd = new FormData();
  if (input.stamp) fd.append("stamp", input.stamp);
  if (input.signature) fd.append("signature", input.signature);
  if (input.activities !== undefined) fd.append("activities", JSON.stringify(input.activities));
  if (input.dgTitle !== undefined) fd.append("dgTitle", input.dgTitle);
  if (input.comptableTitle !== undefined) fd.append("comptableTitle", input.comptableTitle);
  if (input.agentTitle !== undefined) fd.append("agentTitle", input.agentTitle);
  // Champs écriture seule : n'envoyer que si l'utilisateur a tapé quelque
  // chose (une chaîne vide laisserait la clé déjà stockée inchangée côté
  // serveur, mais autant ne pas l'envoyer du tout).
  if (input.fedapayEnabled !== undefined) fd.append("fedapayEnabled", String(input.fedapayEnabled));
  if (input.fedapaySandbox !== undefined) fd.append("fedapaySandbox", String(input.fedapaySandbox));
  if (input.fedapayCollectEnabled !== undefined) fd.append("fedapayCollectEnabled", String(input.fedapayCollectEnabled));
  if (input.fedapayWebhookSecret) fd.append("fedapayWebhookSecret", input.fedapayWebhookSecret);
  if (input.fedapaySecretKey) fd.append("fedapaySecretKey", input.fedapaySecretKey);
  if (input.paymentsPerOrderLimit !== undefined) fd.append("paymentsPerOrderLimit", String(input.paymentsPerOrderLimit));
  if (input.paymentsDailyLimit !== undefined) fd.append("paymentsDailyLimit", String(input.paymentsDailyLimit));
  if (input.defaultRentTiming !== undefined) fd.append("defaultRentTiming", input.defaultRentTiming);
  if (input.defaultEntryProration !== undefined) fd.append("defaultEntryProration", input.defaultEntryProration);
  if (input.depositSbeeEnabled !== undefined) fd.append("depositSbeeEnabled", String(input.depositSbeeEnabled));
  if (input.depositSonebEnabled !== undefined) fd.append("depositSonebEnabled", String(input.depositSonebEnabled));
  if (input.depositPeintureEnabled !== undefined) fd.append("depositPeintureEnabled", String(input.depositPeintureEnabled));
  if (input.chargesEnabled !== undefined) fd.append("chargesEnabled", String(input.chargesEnabled));
  if (input.utilityPassThroughPercent !== undefined) fd.append("utilityPassThroughPercent", String(input.utilityPassThroughPercent));
  if (input.commissionTiming !== undefined) fd.append("commissionTiming", input.commissionTiming);
  if (input.expenseAlertThreshold !== undefined) fd.append("expenseAlertThreshold", input.expenseAlertThreshold === null ? "" : String(input.expenseAlertThreshold));

  return apiFetch<{ settings: TenantSettings }>("/api/settings", {
    method: "PATCH",
    accessToken,
    body: fd,
  });
}
