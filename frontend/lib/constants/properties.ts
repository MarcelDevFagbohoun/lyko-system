import type { PropertyTypeKey, UnitDesignationKey } from "@/lib/api/properties";

/** Miroir de backend/src/constants/properties.js pour l'affichage côté client. */
export const PROPERTY_TYPE_LABELS: Record<PropertyTypeKey, string> = {
  villa: "Villa",
  duplex: "Duplex",
  immeuble: "Immeuble",
  maison_simple: "Maison simple",
  autre: "Autre",
};

export const UNIT_DESIGNATION_LABELS: Record<UnitDesignationKey, string> = {
  studio: "Studio",
  chambre_salon: "Chambre salon",
  chambre_salon_sanitaire_cuisine: "Chambre salon + sanitaire + cuisine",
  appartement_2ch: "Appartement 2 chambres salon + cuisine + douche",
  appartement_3ch: "Appartement 3 chambres salon + SDB + cuisine",
  autre: "Autre",
};

export function unitDesignationLabel(designation: UnitDesignationKey, designationCustom: string | null): string {
  return designation === "autre" ? (designationCustom ?? "Autre") : UNIT_DESIGNATION_LABELS[designation];
}
