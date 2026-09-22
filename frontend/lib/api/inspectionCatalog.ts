import { apiFetch, type Actor } from "./client";

/**
 * Référentiel de prix pour la facturation des dégradations à l'état des
 * lieux de sortie — commun à toute l'entreprise (voir backend migration 056).
 * Prix tout compris (matériel + main d'œuvre), décision explicite de
 * l'utilisateur.
 */
export type CatalogItem = {
  id: number;
  label: string;
  price: number;
  createdBy: Actor;
  createdAt: string;
};

export function listCatalogItems(accessToken: string) {
  return apiFetch<{ items: CatalogItem[] }>("/api/inspection-catalog", { accessToken });
}

export function createCatalogItem(accessToken: string, input: { label: string; price: number }) {
  return apiFetch<{ catalogItemId: number }>("/api/inspection-catalog", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateCatalogItem(accessToken: string, id: number, input: Partial<{ label: string; price: number }>) {
  return apiFetch<{ ok: true }>(`/api/inspection-catalog/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteCatalogItem(accessToken: string, id: number) {
  return apiFetch<{ ok: true }>(`/api/inspection-catalog/${id}`, { method: "DELETE", accessToken });
}
