import { apiFetch, type Actor } from "./client";
import type { PaymentMethod } from "./renters";

export type UtilityType = "soneb" | "sbee";
export type ChargeStatus = "impayee" | "partiellement_payee" | "payee";

export type UtilityCharge = {
  id: number;
  utilityType: UtilityType;
  periodStart: string;
  periodEnd: string;
  readingStart: number;
  readingEnd: number;
  consumption: number;
  unitPrice: number;
  amount: number;
  // Part de l'écart compteur/décompteur imputée à cette facture (0 sauf
  // répartition « prorata » activée sur ce Bien) — `consumptionAmount` est le
  // reste, la seule consommation mesurée : amount = consumptionAmount + lossShareAmount.
  lossShareAmount: number;
  consumptionAmount: number;
  billedAt: string;
  status: ChargeStatus;
  paidAmount: number;
  remainingAmount: number;
  paidAt: string | null;
  paymentMethod: PaymentMethod | null;
  paymentMethodLabel: string | null;
  notes: string | null;
  recordedBy: Actor;
  paidRecordedBy: Actor;
  lease: { id: number; status: "active" | "ended" };
  renter: { id: number; firstName: string; lastName: string };
  unit: { id: number; code: string };
  property: { id: number; code: string };
  createdAt: string;
};

export type UtilityPayment = {
  id: number;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  paidAt: string;
  notes: string | null;
  recordedBy: Actor;
  createdAt: string;
};

export function getChargesMeta(accessToken: string) {
  return apiFetch<{
    utilityTypes: { key: UtilityType; label: string }[];
    statuses: ChargeStatus[];
  }>("/api/charges/meta", { accessToken });
}

export function listCharges(
  accessToken: string,
  filters?: { status?: ChargeStatus; utilityType?: UtilityType; leaseId?: number; q?: string },
) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.utilityType) params.set("utilityType", filters.utilityType);
  if (filters?.leaseId) params.set("leaseId", String(filters.leaseId));
  if (filters?.q) params.set("q", filters.q);
  const qs = params.toString();
  return apiFetch<{ charges: UtilityCharge[] }>(`/api/charges${qs ? `?${qs}` : ""}`, { accessToken });
}

export type CreateChargeInput = {
  leaseId: number;
  utilityType: UtilityType;
  periodStart: string;
  periodEnd: string;
  readingStart: number;
  readingEnd: number;
  unitPrice: number;
  billedAt: string;
  notes?: string;
};

export function createCharge(accessToken: string, input: CreateChargeInput) {
  return apiFetch<{ chargeId: number; consumption: number; amount: number }>("/api/charges", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type UpdateChargeInput = Partial<Omit<CreateChargeInput, "leaseId">>;

export function updateCharge(accessToken: string, id: number, input: UpdateChargeInput) {
  return apiFetch<{ charge: UtilityCharge }>(`/api/charges/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getChargePayments(accessToken: string, id: number) {
  return apiFetch<{ payments: UtilityPayment[] }>(`/api/charges/${id}/payments`, { accessToken });
}

export function recordChargePayment(
  accessToken: string,
  id: number,
  input: { amount: number; paymentMethod: PaymentMethod; paidAt: string; notes?: string },
) {
  return apiFetch<{ charge: UtilityCharge }>(`/api/charges/${id}/payments`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getPreviousReading(accessToken: string, leaseId: number, utilityType: UtilityType) {
  return apiFetch<{ readingEnd: number | null }>(
    `/api/charges/previous-reading?leaseId=${leaseId}&utilityType=${utilityType}`,
    { accessToken },
  );
}

export function deleteCharge(accessToken: string, id: number, reason: string) {
  return apiFetch<void>(`/api/charges/${id}`, {
    method: "DELETE",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

// ── Relevé de compteurs par immeuble (étape 9bis) ────────────────────────

export type LossAllocation = "proprietaire" | "prorata";

export type UtilityConfigEntry = {
  submetered: boolean;
  unitPrice: number | null;
  mainMeterNumber: string | null;
  accountNumber: string | null;
  lossAllocation: LossAllocation;
};
export type UtilityConfig = { soneb: UtilityConfigEntry; sbee: UtilityConfigEntry };

export type UtilityConfigInput = Partial<{
  sonebSubmetered: boolean;
  sbeeSubmetered: boolean;
  sonebUnitPrice: number | null;
  sbeeUnitPrice: number | null;
  sonebMainMeterNumber: string;
  sbeeMainMeterNumber: string;
  sonebAccountNumber: string;
  sbeeAccountNumber: string;
  sonebLossAllocation: LossAllocation;
  sbeeLossAllocation: LossAllocation;
}>;

export function updatePropertyUtilityConfig(accessToken: string, propertyId: number, input: UtilityConfigInput) {
  return apiFetch<{ utilityConfig: UtilityConfig }>(`/api/properties/${propertyId}/utility-config`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type BatchStatus = "brouillon" | "valide";
export type DifferenceAlert = "none" | "high" | "negative";

export type UtilityBatchSummary = {
  id: number;
  utilityType: UtilityType;
  periodStart: string;
  periodEnd: string;
  unitPrice: number;
  status: BatchStatus;
  validatedAt: string | null;
  rowCount: number;
  subConsumption: number;
  subAmount: number;
  mainConsumption: number | null;
  mainAmount: number | null;
  differenceConsumption: number | null;
  differenceAmount: number | null;
};

export type UtilityBatchRow = {
  unitId: number;
  unitCode: string;
  unitLabel: string;
  meterNumber: string | null;
  lease: { id: number; status: "active" | "ended" } | null;
  renter: { firstName: string; lastName: string } | null;
  previousReading: number | null;
  readingStart: number;
  readingEnd: number;
  consumption: number;
  amount: number;
  charge: { id: number; status: ChargeStatus } | null;
};

export type UtilityBatch = {
  batch: {
    id: number;
    propertyId: number;
    propertyCode: string;
    utilityType: UtilityType;
    periodStart: string;
    periodEnd: string;
    unitPrice: number;
    status: BatchStatus;
    validatedAt: string | null;
    lossAllocation: LossAllocation;
    main: { readingStart: number | null; readingEnd: number | null; consumption: number | null; invoiceAmount: number | null };
    recordedBy: Actor;
  };
  rows: UtilityBatchRow[];
  totals: {
    subConsumption: number;
    subAmount: number;
    mainConsumption: number | null;
    mainAmount: number | null;
    differenceConsumption: number | null;
    differenceAmount: number | null;
    differencePct: number | null;
    alert: DifferenceAlert;
  };
};

export function listUtilityBatches(accessToken: string, propertyId: number, utilityType?: UtilityType) {
  const qs = utilityType ? `?utilityType=${utilityType}` : "";
  return apiFetch<{ batches: UtilityBatchSummary[] }>(`/api/properties/${propertyId}/utility-batches${qs}`, { accessToken });
}

export function createUtilityBatch(
  accessToken: string,
  propertyId: number,
  input: { utilityType: UtilityType; periodStart: string; periodEnd: string },
) {
  return apiFetch<UtilityBatch>(`/api/properties/${propertyId}/utility-batches`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getUtilityBatch(accessToken: string, id: number) {
  return apiFetch<UtilityBatch>(`/api/utility-batches/${id}`, { accessToken });
}

export type SaveBatchInput = {
  mainReadingStart?: number | null;
  mainReadingEnd?: number | null;
  mainInvoiceAmount?: number | null;
  readings?: { unitId: number; readingStart: number; readingEnd: number }[];
};

export function saveUtilityBatch(accessToken: string, id: number, input: SaveBatchInput) {
  return apiFetch<UtilityBatch>(`/api/utility-batches/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function validateUtilityBatch(accessToken: string, id: number) {
  return apiFetch<UtilityBatch>(`/api/utility-batches/${id}/validate`, { method: "POST", accessToken });
}

export function reopenUtilityBatch(accessToken: string, id: number) {
  return apiFetch<UtilityBatch>(`/api/utility-batches/${id}/reopen`, { method: "POST", accessToken });
}

export function deleteUtilityBatch(accessToken: string, id: number) {
  return apiFetch<void>(`/api/utility-batches/${id}`, { method: "DELETE", accessToken });
}
