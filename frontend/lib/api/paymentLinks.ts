import { apiFetch } from "./client";

/** Génère un lien de paiement pour un bail (loyer) — voir PaymentLinkCard. */
export function generateLeasePaymentLink(accessToken: string, leaseId: number, amount?: number) {
  return apiFetch<{ token: string; path: string; amount: number }>(`/api/leases/${leaseId}/payment-links`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(amount !== undefined ? { amount } : {}),
  });
}

/** Génère un lien de paiement pour une facture SONEB/SBEE. */
export function generateChargePaymentLink(accessToken: string, chargeId: number) {
  return apiFetch<{ token: string; path: string; amount: number }>(`/api/charges/${chargeId}/payment-links`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Client de la page publique de paiement par lien (`/payer/[token]`) — aucun
 * `accessToken` : le token du lien authentifie déjà, comme le portail.
 */
export type PaymentLinkInfo = {
  tenantId: number;
  companyName: string | null;
  logoUrl: string | null;
  kind: "loyer" | "charge";
  amount: number;
  onlinePaymentEnabled: boolean;
};

export function getPaymentLink(token: string) {
  return apiFetch<PaymentLinkInfo>(`/api/pay/${token}`);
}

export function startPaymentLinkCheckout(token: string) {
  return apiFetch<{ url: string; reference: string }>(`/api/pay/${token}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

/** Page de retour : le serveur relit la transaction chez FedaPay et répond paid | pending | failed. */
export function confirmOnlinePayment(reference: string) {
  return apiFetch<{ state: "paid" | "pending" | "failed" }>("/api/online-payments/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference }),
  });
}
