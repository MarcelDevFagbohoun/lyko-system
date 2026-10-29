import { apiFetch } from "./client";
import type { Refund, PlanKey } from "./billing";

const KEY = "aim_admin_token";
const json = { "Content-Type": "application/json" };

export function getAdminToken(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
export function setAdminToken(token: string | null) {
  try { if (token) sessionStorage.setItem(KEY, token); else sessionStorage.removeItem(KEY); } catch { /* stockage indisponible : session limitée à la page */ }
}

export type PartnerInfo = { features: string[]; limits: { units: number | null; owners: number | null; users: number | null }; note: string | null };
export type AdminTenant = { partner: PartnerInfo | null; id: number; companyName: string; createdAt: string; planKey: string | null; status: string; currentPeriodEnd: string | null; founderPrice: boolean; totalPaid: number; overLimits: string[]; lastPayment: "success" | "failed" | "incomplete" | "granted" | null };

export const adminLogin = (email: string, password: string, code?: string) =>
  apiFetch<{ token: string; name: string }>("/api/admin/login", { method: "POST", headers: json, body: JSON.stringify({ email, password, code: code || undefined }) });
export const adminMe = (t: string) => apiFetch<{ id: number; name: string; twoFactor: boolean }>("/api/admin/me", { accessToken: t });
export const admin2faSetup = (t: string) => apiFetch<{ secret: string; uri: string }>("/api/admin/2fa/setup", { accessToken: t, method: "POST" });
export const admin2faEnable = (t: string, code: string) =>
  apiFetch<{ ok: true }>("/api/admin/2fa/enable", { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ code }) });
export const admin2faDisable = (t: string, password: string, code: string) =>
  apiFetch<{ ok: true }>("/api/admin/2fa/disable", { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ password, code }) });
export type AuditEntry = { id: number; adminEmail: string | null; action: string; target: string | null; details: string | null; ip: string | null; createdAt: string };
export const adminAudit = (t: string) => apiFetch<{ entries: AuditEntry[] }>("/api/admin/audit", { accessToken: t });
export const adminTenants = (t: string) => apiFetch<{ tenants: AdminTenant[] }>("/api/admin/tenants", { accessToken: t });
export type PaymentIssue = { id: number; reference: string; status: "pending" | "failed" | "anomaly"; reason: string | null; planKey: string; months: number; kind: string; amount: number; creditApplied: number; createdAt: string; companyName: string };
export const adminPaymentIssues = (t: string) => apiFetch<{ issues: PaymentIssue[] }>("/api/admin/payment-issues", { accessToken: t });
export const adminRefunds = (t: string, status?: string) =>
  apiFetch<{ refunds: Refund[] }>(`/api/admin/refunds${status ? `?status=${status}` : ""}`, { accessToken: t });
export const adminApprove = (t: string, id: number, feeAmount?: number, note?: string) =>
  apiFetch<{ refundAmount: number }>(`/api/admin/refunds/${id}/approve`, { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ feeAmount, note }) });
export const adminReject = (t: string, id: number, note: string) =>
  apiFetch<{ ok: true }>(`/api/admin/refunds/${id}/reject`, { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ note }) });
export const adminPay = (t: string, id: number) => apiFetch<{ status: string }>(`/api/admin/refunds/${id}/pay`, { accessToken: t, method: "POST" });
export const adminMarkPaid = (t: string, id: number, reference: string) =>
  apiFetch<{ status: string }>(`/api/admin/refunds/${id}/mark-paid`, { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ reference }) });
export const adminRefresh = (t: string, id: number) => apiFetch<{ status: string }>(`/api/admin/refunds/${id}/refresh`, { accessToken: t, method: "POST" });
export const adminSetInternal = (t: string, tenantId: number, note: string) =>
  apiFetch<{ ok: true }>(`/api/admin/tenants/${tenantId}/internal`, { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ note }) });
export const adminGrant = (t: string, tenantId: number, planKey: PlanKey, months: number, note: string) =>
  apiFetch<{ ok: true }>(`/api/admin/tenants/${tenantId}/grant`, { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ planKey, months, note }) });

export type AdminPlan = {
  key: PlanKey;
  label: string;
  featured: boolean;
  limits: { units: number | null; owners: number | null; users: number | null };
  features: string[];
  offers: { months: number; price: number }[];
};
export type AdminCatalog = {
  plans: Record<PlanKey, AdminPlan>;
  founder: { enabled: boolean; planKey: PlanKey; months: number; price: number; maxCompanies: number };
  promo: { enabled: boolean; percent: number };
  refundWindowDays: number;
};
export const adminCatalog = (t: string) =>
  apiFetch<{ catalog: AdminCatalog; features: string[]; changes: { id: number; adminName: string | null; createdAt: string }[] }>("/api/admin/catalog", { accessToken: t });
export const adminSaveCatalog = (t: string, catalog: AdminCatalog) =>
  apiFetch<{ catalog: AdminCatalog }>("/api/admin/catalog", { accessToken: t, method: "PUT", headers: json, body: JSON.stringify(catalog) });
export const adminResetCatalog = (t: string) =>
  apiFetch<{ catalog: AdminCatalog }>("/api/admin/catalog/reset", { accessToken: t, method: "POST" });

export type PartnerGrantInput = {
  months: number;
  features: string[];
  limits: { units: number | null; owners: number | null; users: number | null };
  note: string;
  replacePaid?: boolean;
};
export const adminPartnerFeatures = (t: string) => apiFetch<{ features: string[]; maxMonths: number }>("/api/admin/partner-features", { accessToken: t });
export const adminGrantPartner = (t: string, tenantId: number, input: PartnerGrantInput) =>
  apiFetch<{ ok: true; extended: boolean; currentPeriodEnd: string }>(`/api/admin/tenants/${tenantId}/partner`, { accessToken: t, method: "POST", headers: json, body: JSON.stringify(input) });
export const adminRevokePartner = (t: string, tenantId: number, note: string) =>
  apiFetch<{ ok: true }>(`/api/admin/tenants/${tenantId}/partner/revoke`, { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ note }) });

export type AdminStats = {
  months: number;
  kpis: {
    collectedTotal: number; collectedMonth: number; collectedPrevMonth: number; refundedTotal: number; refundedMonth: number; refundsPending: number;
    mrr: number; mrrPrevious: number;
    success30: number; failed30: number; incomplete30: number; failedAmount30: number; successRate30: number | null; anomalies: number; anomalyAmount: number;
  };
  series: {
    month: string; amount: number; payments: number; failed: number; refunded: number; net: number; mrr: number;
    byPlan: Record<"demarrage" | "pro" | "entreprise", number>; byKind: Record<"purchase" | "renewal" | "upgrade", number>;
  }[];
  daily: { currentMonth: string; previousMonth: string; today: number; daysInCurrent: number; daysInPrevious: number; current: number[]; previous: number[] };
  byPlan: { planKey: string; payments: number; amount: number }[];
  byKind: { kind: string; payments: number; amount: number }[];
  failureReasons: { reason: string; count: number }[];
  tenants: { total: number; newThisMonth: number; paying: number; partners: number; internal: number; expired: number; expiring14: number };
  plans: { planKey: string; count: number }[];
  recent: { id: number; status: string; reason: string | null; planKey: string; months: number; kind: string; amount: number; createdAt: string; paidAt: string | null; companyName: string }[];
};
export const adminStats = (t: string, months = 12) => apiFetch<AdminStats>(`/api/admin/stats?months=${months}`, { accessToken: t });
