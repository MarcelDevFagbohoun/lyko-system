import { apiFetch } from "./client";

export type PlanKey = "demarrage" | "pro" | "entreprise";
export type PlanOffer = { months: number; price: number };
export type PlanLimits = { units: number | null; owners: number | null; users: number | null };
export type PublicPlan = { key: PlanKey; label: string; featured: boolean; limits: PlanLimits; features: string[]; offers: PlanOffer[] };
export type Catalog = {
  plans: PublicPlan[];
  founder: { planKey: PlanKey; months: number; price: number; maxCompanies: number; remaining: number };
  refundWindowDays: number;
};

export type Subscription = {
  planKey: string | null;
  planLabel: string | null;
  status: string;
  active: boolean;
  enforced: boolean;
  periodMonths: number | null;
  currentPeriodEnd: string | null;
  daysLeft: number | null;
  refundOpen: boolean;
  refundEligibleUntil: string | null;
  founderPrice: boolean;
  overLimits?: { kind: string; label: string; count: number; max: number }[];
};

export type SubscriptionPayment = {
  id: number;
  planKey: PlanKey;
  planLabel: string;
  months: number;
  amount: number;
  founderPrice: boolean;
  status: "paid" | "refunded";
  invoiceNumber: string | null;
  paidAt: string | null;
  periodEnd: string | null;
};

export type Quote = { planKey: PlanKey; months: number; price: number; normalPrice: number; founder: boolean; isFirstPurchase: boolean };

export type RefundStatus = "requested" | "approved" | "rejected" | "details_received" | "processing" | "paid" | "failed";
export type Refund = {
  id: number;
  tenantId: number;
  companyName: string;
  status: RefundStatus;
  reason: string;
  amountPaid: number;
  feeAmount: number | null;
  refundAmount: number | null;
  adminNote: string | null;
  payeeName: string | null;
  payeePhone: string | null;
  payeeOperator: "mtn" | "moov" | null;
  createdAt: string;
  decidedAt: string | null;
  paidAt: string | null;
};

const json = { "Content-Type": "application/json" };

export const FEATURE_LABELS: Record<string, string> = {
  core: "Biens, propriétaires, locataires, baux, loyers, quittances, charges, comptabilité simple",
  tenant_collect: "Paiement des loyers par les locataires (FedaPay)",
  payroll: "Fiches de paie et salaires",
  payouts: "Paiements sortants (salaires, reversements)",
  owner_portal: "Portail et relevés propriétaires",
  sale_properties: "Biens à vendre",
  advanced_accounting: "Comptabilité avancée SYSCOHADA",
  audit_full: "Journal d'audit complet et support prioritaire",
};

export const fetchCatalog = () => apiFetch<Catalog>("/api/billing/plans");
export const fetchSubscription = (accessToken: string) => apiFetch<Subscription>("/api/billing/subscription", { accessToken });
export const fetchQuote = (accessToken: string, planKey: PlanKey, months: number) =>
  apiFetch<Quote>("/api/billing/quote", { accessToken, method: "POST", headers: json, body: JSON.stringify({ planKey, months }) });
export const startCheckout = (accessToken: string, planKey: PlanKey, months: number) =>
  apiFetch<{ url: string; reference: string; amount: number; founder: boolean }>("/api/billing/checkout", {
    accessToken, method: "POST", headers: json, body: JSON.stringify({ planKey, months }),
  });
export const confirmSubscriptionPayment = (reference: string) =>
  apiFetch<{ state: "paid" | "pending" | "failed" }>("/api/billing/confirm", { method: "POST", headers: json, body: JSON.stringify({ reference }) });
export const listSubscriptionPayments = (accessToken: string) =>
  apiFetch<{ payments: SubscriptionPayment[] }>("/api/billing/payments", { accessToken });
export const invoicePdfPath = (id: number) => `/api/billing/payments/${id}/invoice.pdf`;
export const requestRefund = (accessToken: string, reason: string) =>
  apiFetch<{ id: number }>("/api/billing/refund-requests", { accessToken, method: "POST", headers: json, body: JSON.stringify({ reason }) });
export const listMyRefunds = (accessToken: string) => apiFetch<{ refunds: Refund[] }>("/api/billing/refund-requests", { accessToken });
export const fetchRefundLink = (token: string) => apiFetch<{ companyName: string; refundAmount: number }>(`/api/billing/refund-link/${token}`);
export const submitRefundLink = (token: string, input: { name: string; phone: string; operator: "mtn" | "moov" }) =>
  apiFetch<{ ok: true }>(`/api/billing/refund-link/${token}`, { method: "POST", headers: json, body: JSON.stringify(input) });

export const INACTIVE_EVENT = "aim:subscription-inactive";

export function limitLabel(v: number | null) {
  return v === null ? "illimité" : String(v);
}
export function offerLabel(months: number) {
  return months === 12 ? "1 an" : `${months} mois`;
}

/** Offre choisie sur la page Tarifs avant inscription (conservée jusqu'au premier paiement). */
export const PENDING_OFFER_KEY = "aim_pending_offer";
