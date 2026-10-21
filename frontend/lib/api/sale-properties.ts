import { apiFetch, type Actor } from "./client";

/**
 * « Biens à vendre » (demande utilisateur, 2026-10-18) — catalogue interne (jamais publié
 * publiquement pour l'instant) des biens (maisons, terrains…) que le cabinet est chargé de vendre.
 * Entièrement séparé des Biens locatifs (`lib/api/properties.ts`) — un terrain n'a ni unité ni loyer.
 */

export type SalePropertyType = "villa" | "duplex" | "immeuble" | "maison_simple" | "terrain" | "autre";
export type SalePropertyStatus = "en_vente" | "en_negociation" | "vendu" | "retire";

export const SALE_PROPERTY_TYPE_LABELS: Record<SalePropertyType, string> = {
  villa: "Villa",
  duplex: "Duplex",
  immeuble: "Immeuble",
  maison_simple: "Maison simple",
  terrain: "Terrain",
  autre: "Autre",
};

export const SALE_PROPERTY_STATUS_LABELS: Record<SalePropertyStatus, string> = {
  en_vente: "En vente",
  en_negociation: "En négociation",
  vendu: "Vendu",
  retire: "Retiré",
};

/** Mode de règlement d'une commission sur vente — jamais `kkiapay` (vente réglée hors ligne). */
export type SalePaymentMethod = "especes" | "mobile_money" | "virement" | "cheque";

export const SALE_PAYMENT_METHOD_LABELS: Record<SalePaymentMethod, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement",
  cheque: "Chèque",
};

/** Détail de la vente (bouton « Vendu ») — toujours `null` tant que `status !== "vendu"`. */
export type SaleDetails = {
  finalPrice: number;
  commissionPercent: number;
  commissionAmount: number;
  paymentMethod: SalePaymentMethod;
  soldAt: string;
  soldBy: Actor;
};

export type SaleProperty = {
  id: number;
  type: SalePropertyType;
  typeLabel: string;
  title: string;
  address: string | null;
  price: number;
  surfaceM2: number | null;
  description: string | null;
  status: SalePropertyStatus;
  photoUrls: string[];
  owner: { id: number; name: string; phone: string | null } | null;
  createdBy: Actor;
  createdAt: string;
  updatedBy: Actor;
  updatedAt: string | null;
  sale: SaleDetails | null;
};

export function listSaleProperties(accessToken: string, filters?: { status?: SalePropertyStatus; q?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.q) params.set("q", filters.q);
  const qs = params.toString();
  return apiFetch<{ saleProperties: SaleProperty[] }>(`/api/sale-properties${qs ? `?${qs}` : ""}`, { accessToken });
}

export function getSaleProperty(accessToken: string, id: number) {
  return apiFetch<{ saleProperty: SaleProperty }>(`/api/sale-properties/${id}`, { accessToken });
}

export type CreateSalePropertyInput = {
  type: SalePropertyType;
  title: string;
  address?: string;
  price: number;
  surfaceM2?: number;
  description?: string;
  ownerId?: number;
};

export function createSaleProperty(accessToken: string, input: CreateSalePropertyInput) {
  return apiFetch<{ saleProperty: SaleProperty }>("/api/sale-properties", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type UpdateSalePropertyInput = Partial<CreateSalePropertyInput> & { status?: SalePropertyStatus };

export function updateSaleProperty(accessToken: string, id: number, input: UpdateSalePropertyInput) {
  return apiFetch<{ saleProperty: SaleProperty }>(`/api/sale-properties/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function addSalePropertyPhotos(accessToken: string, id: number, photos: File[]) {
  const fd = new FormData();
  photos.forEach((f) => fd.append("photos", f));
  return apiFetch<{ saleProperty: SaleProperty }>(`/api/sale-properties/${id}/photos`, {
    method: "POST",
    accessToken,
    body: fd,
  });
}

export function removeSalePropertyPhoto(accessToken: string, id: number, index: number) {
  return apiFetch<{ saleProperty: SaleProperty }>(`/api/sale-properties/${id}/photos/${index}`, {
    method: "DELETE",
    accessToken,
  });
}

export function deleteSaleProperty(accessToken: string, id: number, reason: string) {
  return apiFetch<void>(`/api/sale-properties/${id}`, {
    method: "DELETE",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export type MarkSaleSoldInput = {
  finalPrice: number;
  commissionPercent: number;
  paymentMethod: SalePaymentMethod;
  soldAt?: string;
  idempotencyKey: string;
};

/** Bouton « Vendu » (demande utilisateur, 2026-10-18) — le montant de la commission est toujours
 * calculé côté serveur (prix final × pourcentage), jamais transmis ici. */
export function markSaleSold(accessToken: string, id: number, input: MarkSaleSoldInput) {
  return apiFetch<{ saleProperty: SaleProperty }>(`/api/sale-properties/${id}/mark-sold`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
