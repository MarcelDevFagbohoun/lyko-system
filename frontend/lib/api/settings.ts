import { apiFetch } from "./client";
import type { RoleTitles } from "@/lib/auth/auth-context";

export type ContractPlaceholder = { key: string; label: string };

export type RoleTitlePresets = { dg: string[]; comptable: string[]; agent: string[] };

export type TenantSettings = {
  contractTemplate: string | null;
  defaultContractTemplate: string;
  placeholders: ContractPlaceholder[];
  stampUrl: string | null;
  signatureUrl: string | null;
  roleTitles: RoleTitles;
  roleTitlePresets: RoleTitlePresets;
  kkiapayEnabled: boolean;
  kkiapaySandbox: boolean;
  kkiapayPublicKey: string | null;
  /** Les clés privée/secrète ne sont jamais renvoyées — seulement si elles sont déjà enregistrées. */
  kkiapayConfigured: boolean;
};

export function getSettings(accessToken: string) {
  return apiFetch<{ settings: TenantSettings }>("/api/settings", { accessToken });
}

export function updateSettings(
  accessToken: string,
  input: {
    contractTemplate?: string;
    stamp?: File;
    signature?: File;
    dgTitle?: string;
    comptableTitle?: string;
    agentTitle?: string;
    kkiapayEnabled?: boolean;
    kkiapaySandbox?: boolean;
    kkiapayPublicKey?: string;
    kkiapayPrivateKey?: string;
    kkiapaySecretKey?: string;
  },
) {
  const fd = new FormData();
  if (input.contractTemplate !== undefined) fd.append("contractTemplate", input.contractTemplate);
  if (input.stamp) fd.append("stamp", input.stamp);
  if (input.signature) fd.append("signature", input.signature);
  if (input.dgTitle !== undefined) fd.append("dgTitle", input.dgTitle);
  if (input.comptableTitle !== undefined) fd.append("comptableTitle", input.comptableTitle);
  if (input.agentTitle !== undefined) fd.append("agentTitle", input.agentTitle);
  if (input.kkiapayEnabled !== undefined) fd.append("kkiapayEnabled", String(input.kkiapayEnabled));
  if (input.kkiapaySandbox !== undefined) fd.append("kkiapaySandbox", String(input.kkiapaySandbox));
  if (input.kkiapayPublicKey !== undefined) fd.append("kkiapayPublicKey", input.kkiapayPublicKey);
  // Champs écriture seule : n'envoyer que si l'utilisateur a tapé quelque
  // chose (une chaîne vide laisserait la clé déjà stockée inchangée côté
  // serveur, mais autant ne pas l'envoyer du tout).
  if (input.kkiapayPrivateKey) fd.append("kkiapayPrivateKey", input.kkiapayPrivateKey);
  if (input.kkiapaySecretKey) fd.append("kkiapaySecretKey", input.kkiapaySecretKey);

  return apiFetch<{ settings: TenantSettings }>("/api/settings", {
    method: "PATCH",
    accessToken,
    body: fd,
  });
}
