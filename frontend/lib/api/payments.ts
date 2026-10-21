import { apiFetch } from "./client";

export type PaymentPurpose = "salaire" | "reversement_proprietaire" | "autre";
export type PaymentStatus = "created" | "processing" | "sent" | "failed";
export type PaymentOperator = "mtn" | "moov";

export const PAYMENT_PURPOSE_LABELS: Record<PaymentPurpose, string> = {
  salaire: "Salaire",
  reversement_proprietaire: "Reversement propriétaire",
  autre: "Autre paiement",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  created: "Créé",
  processing: "En cours",
  sent: "Envoyé",
  failed: "Échoué",
};

/** Vue publique d'un ordre : le numéro est masqué par le serveur, jamais de clé ni d'identifiant technique. */
export type PaymentOrder = {
  id: number;
  reference: string;
  purpose: PaymentPurpose;
  amount: number;
  currency: string;
  status: PaymentStatus;
  beneficiaryType: "employee" | "owner" | "other";
  beneficiaryName: string;
  beneficiaryPhoneMasked: string;
  operator: PaymentOperator;
  label: string;
  providerStatus: string | null;
  failureReason: string | null;
  createdAt: string;
  sentAt: string | null;
  applied: boolean;
  appliedRef: string | null;
  createdBy: number;
};

export type PaymentSummary = {
  enabled: boolean;
  sandbox: boolean;
  perOrderLimit: number;
  dailyLimit: number;
  sentToday: number;
};

export type PaymentTimelineEvent = { id: number; event: string; at: string; byUserId: number | null };

type Common = { phone: string; operator: PaymentOperator; password: string; idempotencyKey: string; beneficiaryEmail?: string };

export type CreatePaymentInput =
  | (Common & {
      purpose: "salaire";
      userId: number;
      period: string;
      baseAmount: number;
      bonusAmount?: number;
      bonusLabel?: string;
      deductionAmount?: number;
      deductionLabel?: string;
    })
  | (Common & { purpose: "reversement_proprietaire"; ownerId: number; amount: number; periodLabel: string })
  | (Common & { purpose: "autre"; beneficiaryName: string; amount: number; label: string });

export function getPaymentSummary(accessToken: string) {
  return apiFetch<PaymentSummary>("/api/payments/summary", { accessToken });
}

export function listPaymentOrders(
  accessToken: string,
  filters: { status?: PaymentStatus; purpose?: PaymentPurpose; from?: string; to?: string; limit?: number; offset?: number } = {},
) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiFetch<{ orders: PaymentOrder[] }>(`/api/payments/orders${suffix}`, { accessToken });
}

export function getPaymentOrder(accessToken: string, id: number) {
  return apiFetch<{ order: PaymentOrder; timeline: PaymentTimelineEvent[] }>(`/api/payments/orders/${id}`, { accessToken });
}

export function createPaymentOrder(accessToken: string, input: CreatePaymentInput) {
  return apiFetch<{ order: PaymentOrder; replayed: boolean }>("/api/payments/orders", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function refreshPaymentOrder(accessToken: string, id: number) {
  return apiFetch<{ order: PaymentOrder }>(`/api/payments/orders/${id}/refresh`, { method: "POST", accessToken });
}

export function retryApplyPaymentOrder(accessToken: string, id: number) {
  return apiFetch<{ order: PaymentOrder }>(`/api/payments/orders/${id}/retry-apply`, { method: "POST", accessToken });
}

export function verifyPaymentAudit(accessToken: string) {
  return apiFetch<{ ok: boolean; count: number; brokenAtId?: number }>("/api/payments/audit/verify", { accessToken });
}

export function paymentAdvicePdfPath(id: number) {
  return `/api/payments/orders/${id}/advice.pdf`;
}
