import { apiFetch, type Actor } from "./client";
import type { PaymentMethod } from "./renters";
import type { PropertyTypeKey } from "./properties";

export type Owner = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdBy: Actor;
  createdAt: string;
};

export type OwnerListItem = Owner & {
  propertiesCount: number;
  unitsCount: number;
  unitsOccupied: number;
  monthlyRentTotal: number;
};

export type OwnerUnit = {
  id: number;
  code: string;
  designationLabel: string;
  status: "libre" | "loue" | "reserve";
  monthlyRent: number;
  currentRenter: string | null;
};

export type OwnerProperty = {
  id: number;
  code: string;
  address: string | null;
  type: PropertyTypeKey;
  typeLabel: string;
  levels: number | null;
  units: OwnerUnit[];
};

export type OwnerPayout = {
  id: number;
  amount: number;
  periodLabel: string;
  paidAt: string;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  notes: string | null;
  recordedBy: Actor;
};

export function listOwners(accessToken: string, q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<{ owners: OwnerListItem[] }>(`/api/owners${qs}`, { accessToken });
}

/** Un taux de commission historisé : `endsOn: null` = taux actif. */
export type CommissionRate = {
  id: number;
  rate: number;
  startsOn: string;
  endsOn: string | null;
  setBy: Actor;
  createdAt: string;
};

export function getOwner(accessToken: string, id: number) {
  return apiFetch<{
    owner: Owner;
    properties: OwnerProperty[];
    payouts: OwnerPayout[];
    activeCommissionRate: CommissionRate | null;
    commissionRates: CommissionRate[];
  }>(`/api/owners/${id}`, { accessToken });
}

export type CreateOwnerInput = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};

export function createOwner(accessToken: string, input: CreateOwnerInput) {
  return apiFetch<{ ownerId: number }>("/api/owners", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type UpdateOwnerInput = Partial<CreateOwnerInput>;

export function updateOwner(accessToken: string, id: number, input: UpdateOwnerInput) {
  return apiFetch<{ owner: Owner }>(`/api/owners/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type CreatePayoutInput = {
  amount: number;
  periodLabel: string;
  paidAt: string;
  paymentMethod: PaymentMethod;
  notes?: string;
};

export function createPayout(accessToken: string, ownerId: number, input: CreatePayoutInput) {
  return apiFetch<{ payoutId: number }>(`/api/owners/${ownerId}/payouts`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function statementPdfPath(ownerId: number) {
  return `/api/owners/${ownerId}/statement.pdf`;
}

export type UpdateCommissionRateInput = {
  rate: number;
  /** Facultatif : aujourd'hui par défaut côté serveur. */
  startsOn?: string;
};

/**
 * Nouveau taux de commission (DG uniquement) — clôture le taux actif et en
 * crée un nouveau, jamais un écrasement (historique préservé).
 */
export function updateCommissionRate(accessToken: string, ownerId: number, input: UpdateCommissionRateInput) {
  return apiFetch<{ rateId: number; rate: number; startsOn: string; endsOn: null }>(
    `/api/owners/${ownerId}/commission-rate`,
    {
      method: "PUT",
      accessToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}
