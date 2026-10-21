import { apiFetch } from "./client";
import type { Refund, PlanKey } from "./billing";

const KEY = "lyko_admin_token";
const json = { "Content-Type": "application/json" };

export function getAdminToken(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
export function setAdminToken(token: string | null) {
  try { if (token) sessionStorage.setItem(KEY, token); else sessionStorage.removeItem(KEY); } catch { /* stockage indisponible : session limitée à la page */ }
}

export type AdminTenant = { id: number; companyName: string; createdAt: string; planKey: string | null; status: string; currentPeriodEnd: string | null; founderPrice: boolean; totalPaid: number };

export const adminLogin = (email: string, password: string) =>
  apiFetch<{ token: string; name: string }>("/api/admin/login", { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
export const adminMe = (t: string) => apiFetch<{ id: number; name: string }>("/api/admin/me", { accessToken: t });
export const adminTenants = (t: string) => apiFetch<{ tenants: AdminTenant[] }>("/api/admin/tenants", { accessToken: t });
export const adminRefunds = (t: string, status?: string) =>
  apiFetch<{ refunds: Refund[] }>(`/api/admin/refunds${status ? `?status=${status}` : ""}`, { accessToken: t });
export const adminApprove = (t: string, id: number, feeAmount?: number, note?: string) =>
  apiFetch<{ refundAmount: number }>(`/api/admin/refunds/${id}/approve`, { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ feeAmount, note }) });
export const adminReject = (t: string, id: number, note: string) =>
  apiFetch<{ ok: true }>(`/api/admin/refunds/${id}/reject`, { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ note }) });
export const adminPay = (t: string, id: number) => apiFetch<{ status: string }>(`/api/admin/refunds/${id}/pay`, { accessToken: t, method: "POST" });
export const adminRefresh = (t: string, id: number) => apiFetch<{ status: string }>(`/api/admin/refunds/${id}/refresh`, { accessToken: t, method: "POST" });
export const adminGrant = (t: string, tenantId: number, planKey: PlanKey, months: number, note: string) =>
  apiFetch<{ ok: true }>(`/api/admin/tenants/${tenantId}/grant`, { accessToken: t, method: "POST", headers: json, body: JSON.stringify({ planKey, months, note }) });
