import { apiFetch } from "./client";

export type ContractPlaceholder = { key: string; label: string };

export type TenantSettings = {
  contractTemplate: string | null;
  defaultContractTemplate: string;
  placeholders: ContractPlaceholder[];
  stampUrl: string | null;
  signatureUrl: string | null;
};

export function getSettings(accessToken: string) {
  return apiFetch<{ settings: TenantSettings }>("/api/settings", { accessToken });
}

export function updateSettings(
  accessToken: string,
  input: { contractTemplate?: string; stamp?: File; signature?: File },
) {
  const fd = new FormData();
  if (input.contractTemplate !== undefined) fd.append("contractTemplate", input.contractTemplate);
  if (input.stamp) fd.append("stamp", input.stamp);
  if (input.signature) fd.append("signature", input.signature);

  return apiFetch<{ settings: TenantSettings }>("/api/settings", {
    method: "PATCH",
    accessToken,
    body: fd,
  });
}
