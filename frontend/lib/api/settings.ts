import { apiFetch } from "./client";
import type { RoleTitles } from "@/lib/auth/auth-context";
import type { RentTiming } from "./renters";

export type RoleTitlePresets = { dg: string[]; comptable: string[]; agent: string[] };

export type TenantSettings = {
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
};

export function getSettings(accessToken: string) {
  return apiFetch<{ settings: TenantSettings }>("/api/settings", { accessToken });
}

export function updateSettings(
  accessToken: string,
  input: {
    stamp?: File;
    signature?: File;
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
  },
) {
  const fd = new FormData();
  if (input.stamp) fd.append("stamp", input.stamp);
  if (input.signature) fd.append("signature", input.signature);
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

  return apiFetch<{ settings: TenantSettings }>("/api/settings", {
    method: "PATCH",
    accessToken,
    body: fd,
  });
}
