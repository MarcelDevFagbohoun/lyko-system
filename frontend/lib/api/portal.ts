import { apiFetch, API_URL } from "./client";
import type { PaymentMethod } from "./renters";
import type { ComplaintCategory, ComplaintPriority } from "./complaints";

/**
 * Client du portail locataire (étape 12, idée n°2) : aucun `accessToken`
 * ici — le token du lien secret est déjà dans le chemin de chaque appel,
 * c'est lui qui authentifie (voir backend/src/middleware/portalAuth.js).
 * Les GET passent par `apiFetch`, donc profitent du même cache hors-ligne
 * (étape 11) que le reste de l'app : un locataire qui a déjà ouvert son
 * lien une fois peut revoir la dernière situation connue sans réseau.
 */

export type PortalArrears = {
  paidThroughMonth: string | null;
  nextDueMonth: string;
  dueDate: string;
  daysLate: number;
  status: "current" | "late";
};

export type PortalPayment = {
  id: number;
  coversMonth: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paidAt: string;
  receipt: { id: number; number: string } | null;
};

export type PortalDashboard = {
  tenant: { companyName: string | null; logoUrl: string | null };
  renter: { firstName: string; lastName: string };
  activeLease: {
    id: number;
    unitCode: string;
    designationLabel: string;
    monthlyRent: number;
    startDate: string;
  } | null;
  arrears: PortalArrears | null;
  payments: PortalPayment[];
};

export function getPortalDashboard(token: string) {
  return apiFetch<PortalDashboard>(`/api/portal/${token}`);
}

export function portalReceiptPdfUrl(token: string, paymentId: number) {
  return `${API_URL}/api/portal/${token}/payments/${paymentId}/receipt.pdf`;
}

export function portalCertificatePdfUrl(token: string) {
  return `${API_URL}/api/portal/${token}/certificate.pdf`;
}

export type PortalComplaintInput = {
  category: ComplaintCategory;
  title: string;
  description?: string;
  priority?: ComplaintPriority;
};

export function submitPortalComplaint(token: string, input: PortalComplaintInput) {
  return apiFetch<{ complaintId: number; code: string }>(`/api/portal/${token}/complaints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
