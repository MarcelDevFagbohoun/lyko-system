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
  lastFailure?: { reference: string; planKey: PlanKey; months: number; amount: number; reason: string; anomaly: boolean; at: string } | null;
  overLimits?: { kind: string; label: string; count: number; max: number }[];
};

export type SubscriptionPayment = {
  id: number;
  planKey: PlanKey;
  planLabel: string;
  months: number;
  kind: "purchase" | "renewal" | "upgrade";
  creditApplied: number;
  upgradedFromPlan: PlanKey | null;
  amount: number;
  founderPrice: boolean;
  status: "paid" | "refunded";
  invoiceNumber: string | null;
  paidAt: string | null;
  periodEnd: string | null;
};

export type Quote = {
  planKey: PlanKey; months: number; kind: "purchase" | "renewal" | "upgrade"; price: number; normalPrice: number; fullPrice: number;
  credit: number; creditDays: number; fromPlan: PlanKey | null; founder: boolean; isFirstPurchase: boolean;
};
export type UpgradeOption = { planKey: PlanKey; months: number; fullPrice: number; credit: number; creditDays: number; price: number };
export const fetchUpgradeOptions = (accessToken: string) => apiFetch<{ options: UpgradeOption[] }>("/api/billing/upgrade-options", { accessToken });

export type RefundStatus = "requested" | "approved" | "rejected" | "details_received" | "processing" | "paid" | "failed";
export type AccountType = "mtn" | "moov" | "celtiis" | "banque" | "autre";
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { mtn: "MTN Mobile Money", moov: "Moov Money", celtiis: "Celtiis Cash", banque: "Compte bancaire", autre: "Autre" };
export type Refund = {
  id: number;
  kind: "guarantee" | "cancellation";
  daysRemaining: number | null;
  amountOriginal: number | null;
  payeeFirstName: string | null;
  payeeAccountType: AccountType | null;
  payeeAccountNumber: string | null;
  payeeAccountLabel: string | null;
  payeeOtherDetail: string | null;
  paidManually: boolean;
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
  // Label ajouté (demande utilisateur, 2026-10-23) — `ai_assistant` reste absent de `features` sur
  // demarrage/pro/entreprise (backend constants/plans.js) : aucune offre ne la coche pour l'instant.
  ai_assistant: "Assistant IA",
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
export type RefundDetailsInput = { lastName: string; firstName: string; accountType: AccountType; accountNumber: string; accountLabel: string; otherDetail?: string };
export const submitRefundLink = (token: string, input: RefundDetailsInput) =>
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
