import { apiFetch } from "./client";
import type { UnitDesignationKey, PropertyTypeKey } from "./properties";

// Marketplace (demande directe de l'utilisateur) : quand une Unité se
// libère, comptable/agent/DG peuvent publier une annonce (description +
// photos) sur une page publique partageable — pas de lien secret comme les
// portails locataire/propriétaire, une annonce est faite pour être vue.

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

/** Mes annonces publiées (gestion interne, `/espace/marketplace`). */
export function listMyListings(accessToken: string) {
  return apiFetch<{ listings: MarketplaceListing[] }>("/api/marketplace", { accessToken });
}

export type PublishListingInput = {
  description?: string;
  photos?: File[];
};

/** Publie (ou republie, remplace tout) une annonce pour une Unité vacante. */
export function publishListing(accessToken: string, unitId: number, input: PublishListingInput) {
  const fd = new FormData();
  if (input.description) fd.append("description", input.description);
  input.photos?.forEach((f) => fd.append("photos", f));
  return apiFetch<{ listing: MarketplaceListing }>(`/api/marketplace/${unitId}`, {
    method: "POST",
    accessToken,
    body: fd,
  });
}

/** Retire une annonce de la marketplace. */
export function unpublishListing(accessToken: string, unitId: number) {
  return apiFetch<void>(`/api/marketplace/${unitId}`, { method: "DELETE", accessToken });
}

// --- Demandes « confier un bien » reçues depuis Quick Immo (site externe) -

export type RequestType = "louer" | "vendre";
export type RequestStatus = "en_attente" | "contactee" | "acceptee" | "refusee";

export type MarketplaceRequest = {
  id: number;
  requestType: RequestType;
  address: string;
  description: string | null;
  status: RequestStatus;
  createdAt: string;
  owner: { name: string; phone: string };
  reviewedBy: { name: string; role: string; roleLabel: string } | null;
  reviewedAt: string | null;
};

/** Demandes reçues depuis Quick Immo, pour ce cabinet (gestion interne). */
export function listMarketplaceRequests(accessToken: string) {
  return apiFetch<{ requests: MarketplaceRequest[] }>("/api/marketplace/requests", { accessToken });
}

/** Marque une demande contactée/acceptée/refusée. */
export function updateMarketplaceRequestStatus(
  accessToken: string,
  requestId: number,
  status: Exclude<RequestStatus, "en_attente">,
) {
  return apiFetch<void>(`/api/marketplace/requests/${requestId}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
