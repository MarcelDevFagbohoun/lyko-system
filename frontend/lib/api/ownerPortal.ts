import { apiFetch, API_URL } from "./client";
import type { PaymentMethod } from "./renters";
import type { UnitStatus } from "./properties";
import type { OwnerCarnet } from "./charges";

/**
 * Client du portail propriétaire (étape 13, idée n°1) : même principe que
 * le portail locataire (`lib/api/portal.ts`) — aucun `accessToken`, le token
 * du lien secret est déjà dans le chemin de chaque appel.
 */

export type OwnerPortalUnit = {
  id: number;
  code: string;
  designationLabel: string;
  status: UnitStatus;
  monthlyRent: number;
  currentRenter: string | null;
};

export type OwnerPortalProperty = {
  id: number;
  code: string;
  address: string | null;
  type: string;
  typeLabel: string;
  units: OwnerPortalUnit[];
};

/** Recette nette d'un Bien pour le mois affiché, et sa répartition cabinet/propriétaire. */
export type OwnerPortalRecetteEntry = {
  propertyId: number;
  propertyCode: string;
  totalPayments: number;
  totalExpenses: number;
  recetteNette: number;
  rate: number;
  rateDefined: boolean;
  commissionCabinet: number;
  partProprietaire: number;
};

export type OwnerPortalPayout = {
  id: number;
  amount: number;
  periodLabel: string;
  paidAt: string;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  notes: string | null;
};

export type OwnerPortalDashboard = {
  tenant: { companyName: string | null; logoUrl: string | null };
  owner: { name: string };
  properties: OwnerPortalProperty[];
  recette: {
    yearMonth: string;
    byProperty: OwnerPortalRecetteEntry[];
    totals: Omit<OwnerPortalRecetteEntry, "propertyId" | "propertyCode" | "rate" | "rateDefined">;
  };
  payouts: OwnerPortalPayout[];
  /** Carnet des charges SONEB/SBEE : les 6 mois se terminant au mois affiché (étape 31). */
  charges: OwnerCarnet;
};

/** `mois` facultatif (AAAA-MM) : le mois en cours par défaut côté serveur. */
export function getOwnerPortalDashboard(token: string, mois?: string) {
  const qs = mois ? `?mois=${encodeURIComponent(mois)}` : "";
  return apiFetch<OwnerPortalDashboard>(`/api/owner-portal/${token}${qs}`);
}

export function ownerPortalStatementPdfUrl(token: string) {
  return `${API_URL}/api/owner-portal/${token}/statement.pdf`;
}

/** Carnet des charges en PDF (5 téléchargements max + code de vérification, comme le relevé). */
export function ownerPortalCarnetPdfUrl(token: string, from: string, to: string) {
  return `${API_URL}/api/owner-portal/${token}/carnet-charges.pdf?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}
