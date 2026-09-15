import { apiFetch, TENANT_ID } from "./client";

export type UnitDesignationKey =
  | "studio"
  | "chambre_salon"
  | "chambre_salon_sanitaire_cuisine"
  | "appartement_2ch"
  | "appartement_3ch"
  | "autre";
export type PropertyTypeKey = "villa" | "duplex" | "immeuble" | "maison_simple" | "autre";

export type MarketplaceListing = {
  id: number;
  unitId: number;
  unitCode: string;
  designation: UnitDesignationKey;
  designationCustom: string | null;
  monthlyRent: number;
  furnished: boolean;
  propertyCode: string;
  propertyType: PropertyTypeKey;
  address: string | null;
  description: string | null;
  photoUrls: string[];
  publishedAt: string;
};

export type PublicMarketplace = {
  tenant: { companyName: string; phone: string; logoUrl: string | null };
  listings: MarketplaceListing[];
};

/** Page publique — aucune authentification, un seul cabinet pour l'instant (`TENANT_ID`). */
export function getPublicMarketplace() {
  return apiFetch<PublicMarketplace>(`/api/marketplace/public/${TENANT_ID}`);
}
