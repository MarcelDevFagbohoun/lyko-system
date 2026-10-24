import { apiFetch, type Actor } from "./client";

/**
 * Fiches de paie (demande utilisateur, 2026-10-18) : paiement du salaire d'un employé (comptable,
 * agent ou DG lui-même). Réservé au DG (comme `lib/api/employees.ts`, mais couvre AUSSI le DG —
 * `GET /api/payslips/staff` liste tout le personnel, contrairement à `/api/employees`).
 */

export type StaffRole = "dg" | "comptable" | "agent";

export type StaffMember = {
  id: number;
  firstName: string;
  lastName: string;
  role: StaffRole;
  roleLabel: string;
  baseSalary: number | null;
  /** N° Mobile Money mémorisé (toujours masqué par le serveur). */
  momoPhoneMasked: string | null;
  momoOperator: "mtn" | "moov" | null;
  lastPayslip: { period: string; netAmount: number; paidAt: string } | null;
};

export type PayslipPaymentMethod = "especes" | "mobile_money" | "virement" | "cheque";

export const PAYSLIP_PAYMENT_METHOD_LABELS: Record<PayslipPaymentMethod, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement",
  cheque: "Chèque",
};

export type Payslip = {
  id: number;
  employee: { id: number; name: string; role: StaffRole; roleLabel: string };
  period: string;
  baseAmount: number;
  bonusAmount: number;
  bonusLabel: string | null;
  deductionAmount: number;
  deductionLabel: string | null;
  grossAmount: number;
  netAmount: number;
  cnssEmployeeAmount: number;
  cnssEmployerAmount: number;
  itsAmount: number;
  paymentMethod: PayslipPaymentMethod;
  paidAt: string;
  createdBy: Actor;
  createdAt: string;
};

export type PayrollPreview = {
  level: "net" | "cnss" | "complet";
  cnssEmployee: number;
  cnssEmployer: number;
  its: number;
  taxableBase: number;
  net: number;
  cnssEmployeeRate: number;
  cnssEmployerRate: number;
};

/** Calcul de la paie (CNSS/ITS) avec les mêmes règles que le paiement, avant d'enregistrer. */
export function previewPayroll(accessToken: string, gross: number, deduction: number) {
  return apiFetch<PayrollPreview>(`/api/payslips/preview?gross=${gross}&deduction=${deduction}`, { accessToken });
}

export function listStaff(accessToken: string) {
  return apiFetch<{ staff: StaffMember[] }>("/api/payslips/staff", { accessToken });
}

export function updateBaseSalary(accessToken: string, userId: number, baseSalary: number | null) {
  return apiFetch<void>(`/api/payslips/staff/${userId}/base-salary`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseSalary }),
  });
}

export function updateStaffMomo(accessToken: string, userId: number, input: { phone?: string; operator?: "mtn" | "moov" }) {
  return apiFetch<void>(`/api/payslips/staff/${userId}/momo`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function listPayslips(accessToken: string, filters?: { userId?: number; period?: string }) {
  const params = new URLSearchParams();
  if (filters?.userId) params.set("userId", String(filters.userId));
  if (filters?.period) params.set("period", filters.period);
  const qs = params.toString();
  return apiFetch<{ payslips: Payslip[] }>(`/api/payslips${qs ? `?${qs}` : ""}`, { accessToken });
}

export type CreatePayslipInput = {
  userId: number;
  period: string;
  baseAmount: number;
  bonusAmount?: number;
  bonusLabel?: string;
  deductionAmount?: number;
  deductionLabel?: string;
  paymentMethod: PayslipPaymentMethod;
  paidAt: string;
  idempotencyKey: string;
};

export function createPayslip(accessToken: string, input: CreatePayslipInput) {
  return apiFetch<{ payslip: Payslip }>("/api/payslips", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deletePayslip(accessToken: string, id: number, reason: string) {
  return apiFetch<void>(`/api/payslips/${id}`, {
    method: "DELETE",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export function payslipPdfPath(id: number) {
  return `/api/payslips/${id}/pdf`;
}
