import { apiFetch, type Actor } from "./client";

export type PropertyTypeKey = "villa" | "duplex" | "immeuble" | "maison_simple" | "autre";
export type UnitDesignationKey =
  | "studio"
  | "chambre_salon"
  | "chambre_salon_sanitaire_cuisine"
  | "appartement_2ch"
  | "appartement_3ch"
  | "autre";
export type UnitStatus = "libre" | "loue" | "reserve";

export type CatalogEntry<K extends string> = { key: K; label: string };

/** Propriétaire tel qu'imbriqué dans un Bien (fiche à part entière, étape 5). */
export type PropertyOwner = { id: number; name: string; phone: string | null };

/** Agent responsable de ce Bien (étape 14) — `null` si non attribué. */
export type PropertyAgent = { id: number; name: string };

export type UtilityConfigEntry = {
  submetered: boolean;
  unitPrice: number | null;
  mainMeterNumber: string | null;
  accountNumber: string | null;
  lossAllocation: "proprietaire" | "prorata";
};

export type Property = {
  id: number;
  code: string;
  owner: PropertyOwner;
  // Agent responsable (étape 14) : gère uniquement les Biens qui lui sont
  // attribués une fois qu'il en a au moins un — voir la fiche employé.
  agent: PropertyAgent | null;
  agentAssignedAt: string | null;
  address: string | null;
  // Coordonnées GPS (étape 13, idée n°10 : carte du portefeuille) — `null`
  // tant que personne n'a placé le repère sur la carte.
  latitude: number | null;
  longitude: number | null;
  locationSetAt: string | null;
  type: PropertyTypeKey;
  levels: number | null;
  photoUrls: string[];
  utilityConfig: { soneb: UtilityConfigEntry; sbee: UtilityConfigEntry };
  createdBy: Actor;
  createdAt: string;
};

export type PropertyListItem = Property & { unitsCount: number; unitsFree: number };

export type Unit = {
  id: number;
  propertyId: number;
  code: string;
  designation: UnitDesignationKey;
  designationCustom: string | null;
  status: UnitStatus;
  monthlyRent: number;
  sonebMeterNumber: string | null;
  sbeeMeterNumber: string | null;
  furnished: boolean;
  createdBy: Actor;
  currentRenter: { id: number; name: string } | null;
};

export function getPropertiesMeta(accessToken: string) {
  return apiFetch<{
    propertyTypes: CatalogEntry<PropertyTypeKey>[];
    unitDesignations: CatalogEntry<UnitDesignationKey>[];
  }>("/api/properties/meta", { accessToken });
}

export function listProperties(accessToken: string, q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<{ properties: PropertyListItem[] }>(`/api/properties${qs}`, { accessToken });
}

export function getProperty(accessToken: string, id: number) {
  return apiFetch<{ property: Property; units: Unit[] }>(`/api/properties/${id}`, { accessToken });
}

/** Recette nette d'un Bien pour un mois, et sa répartition cabinet/propriétaire. */
export type PropertyRecette = {
  propertyId: number;
  ownerId: number;
  yearMonth: string;
  totalPayments: number;
  totalExpenses: number;
  recetteNette: number;
  rate: number;
  /** `false` si aucun taux n'a jamais été défini pour ce propriétaire (0 % appliqué par défaut). */
  rateDefined: boolean;
  rateStartsOn: string | null;
  commissionCabinet: number;
  partProprietaire: number;
};

/** `month` au format 'AAAA-MM'. */
export function getPropertyRecette(accessToken: string, propertyId: number, month: string) {
  return apiFetch<{ recette: PropertyRecette }>(
    `/api/properties/${propertyId}/recette?mois=${encodeURIComponent(month)}`,
    { accessToken },
  );
}

export type CreatePropertyInput = {
  ownerId: number;
  address?: string;
  latitude?: number;
  longitude?: number;
  propertyType: PropertyTypeKey;
  levels?: number;
  photos?: File[];
};

function toPropertyFormData(input: Omit<CreatePropertyInput, "photos">, photos?: File[]) {
  const fd = new FormData();
  fd.append("ownerId", String(input.ownerId));
  if (input.address) fd.append("address", input.address);
  if (input.latitude !== undefined) fd.append("latitude", String(input.latitude));
  if (input.longitude !== undefined) fd.append("longitude", String(input.longitude));
  fd.append("propertyType", input.propertyType);
  if (input.levels !== undefined) fd.append("levels", String(input.levels));
  photos?.forEach((f) => fd.append("photos", f));
  return fd;
}

export function createProperty(accessToken: string, input: CreatePropertyInput) {
  const { photos, ...rest } = input;
  return apiFetch<{ propertyId: number; code: string }>("/api/properties", {
    method: "POST",
    accessToken,
    body: toPropertyFormData(rest, photos),
  });
}

export type UpdatePropertyInput = Partial<Omit<CreatePropertyInput, "photos">> & { photos?: File[] };

export function updateProperty(accessToken: string, id: number, input: UpdatePropertyInput) {
  const { photos, ...rest } = input;
  const fd = new FormData();
  if (rest.ownerId !== undefined) fd.append("ownerId", String(rest.ownerId));
  if (rest.address !== undefined) fd.append("address", rest.address ?? "");
  if (rest.latitude !== undefined) fd.append("latitude", String(rest.latitude));
  if (rest.longitude !== undefined) fd.append("longitude", String(rest.longitude));
  if (rest.propertyType !== undefined) fd.append("propertyType", rest.propertyType);
  if (rest.levels !== undefined) fd.append("levels", String(rest.levels));
  photos?.forEach((f) => fd.append("photos", f));
  return apiFetch<{ property: Property }>(`/api/properties/${id}`, {
    method: "PATCH",
    accessToken,
    body: fd,
  });
}

export type CreateUnitInput = {
  designation: UnitDesignationKey;
  designationCustom?: string;
  monthlyRent: number;
  sonebMeterNumber?: string;
  sbeeMeterNumber?: string;
  furnished?: boolean;
};

export function createUnit(accessToken: string, propertyId: number, input: CreateUnitInput) {
  return apiFetch<{ unitId: number; code: string }>(`/api/properties/${propertyId}/units`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type UpdateUnitInput = Partial<CreateUnitInput> & { status?: UnitStatus };

export function updateUnit(accessToken: string, propertyId: number, unitId: number, input: UpdateUnitInput) {
  return apiFetch<{ unit: Unit }>(`/api/properties/${propertyId}/units/${unitId}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Le locataire a quitté : termine le bail actif s'il y en a un et remet l'unité « Libre ». */
export function releaseUnit(accessToken: string, propertyId: number, unitId: number) {
  return apiFetch<{ unit: Unit; releasedLeaseId: number | null }>(
    `/api/properties/${propertyId}/units/${unitId}/release`,
    { method: "POST", accessToken },
  );
}
