import { apiFetch, API_URL } from "./client";
import type { PaymentMethod, RentStripMonth } from "./renters";
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
  /** Déjà payé pour `nextDueMonth` — absent d'une réponse mise en cache avant cette version. */
  paidForNextDueMonth?: number;
  dueDate: string;
  daysLate: number;
  monthsLate: number;
  remainderDaysLate: number;
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

export type PortalUnpaidCharge = {
  id: number;
  utilityType: "soneb" | "sbee";
  periodStart: string;
  periodEnd: string;
  amount: number;
  remaining: number;
  status: "impayee" | "partiellement_payee";
};

export type PortalChargePayment = {
  id: number;
  utilityType: "soneb" | "sbee";
  periodStart: string;
  periodEnd: string;
  amount: number;
  paidAt: string;
};

export type PortalDashboard = {
  tenant: {
    id: number;
    companyName: string | null;
    logoUrl: string | null;
    onlinePaymentEnabled: boolean;
  };
  renter: { firstName: string; lastName: string };
  activeLease: {
    id: number;
    unitCode: string;
    designationLabel: string;
    monthlyRent: number;
    startDate: string;
    /** Le contrat de bail a été signé par les deux parties (étape 46) — sinon rien à télécharger. */
    hasSignedContract: boolean;
  } | null;
  arrears: PortalArrears | null;
  /** Ses 12 mois de loyer, mois par mois (null sans bail actif). */
  rentStrip: RentStripMonth[] | null;
  payments: PortalPayment[];
  unpaidCharges: PortalUnpaidCharge[];
  chargePayments: PortalChargePayment[];
  /** Dernier bail, actif OU terminé (étape 48) — états des lieux signés, consultables même après la
   * fin du bail (contrairement à `activeLease` ci-dessus, restreint volontairement au bail en cours). */
  lastLease: { id: number; hasSignedMoveIn: boolean; hasSignedMoveOut: boolean } | null;
};

export function getPortalDashboard(token: string) {
  return apiFetch<PortalDashboard>(`/api/portal/${token}`);
}

export type CheckoutResult = { url: string; reference: string };

/** Ouvre une page de paiement FedaPay pour le loyer — le serveur crée la transaction, le navigateur ne fait que rediriger. */
export function startPortalRentCheckout(token: string, amount: number) {
  return apiFetch<CheckoutResult>(`/api/portal/${token}/rent/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
}

export function startPortalChargeCheckout(token: string, chargeId: number) {
  return apiFetch<CheckoutResult>(`/api/portal/${token}/charges/${chargeId}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function portalReceiptPdfUrl(token: string, paymentId: number) {
  return `${API_URL}/api/portal/${token}/payments/${paymentId}/receipt.pdf`;
}

export function portalChargeReceiptPdfUrl(token: string, paymentId: number) {
  return `${API_URL}/api/portal/${token}/charge-payments/${paymentId}/receipt.pdf`;
}

/** Contrat de bail signé (étape 46) — 404 tant qu'il n'a pas été signé par les deux parties. */
export function portalContractPdfUrl(token: string) {
  return `${API_URL}/api/portal/${token}/contract.pdf`;
}

/** États des lieux signés (étape 48) — accessibles même après la fin du bail, voir `lastLease` ci-dessus. */
export function portalMoveInReportPdfUrl(token: string) {
  return `${API_URL}/api/portal/${token}/move-in-report.pdf`;
}
export function portalMoveOutReportPdfUrl(token: string) {
  return `${API_URL}/api/portal/${token}/move-out-report.pdf`;
}

export type PortalComplaintInput = {
  category: ComplaintCategory;
  title: string;
  description?: string;
  priority?: ComplaintPriority;
  idempotencyKey?: string;
};

export function submitPortalComplaint(token: string, input: PortalComplaintInput) {
  return apiFetch<{ complaintId: number; code: string }>(`/api/portal/${token}/complaints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
