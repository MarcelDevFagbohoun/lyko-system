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
  kkiapaySandbox: boolean;
  kkiapayPublicKey: string | null;
};

export function getPaymentLink(token: string) {
  return apiFetch<PaymentLinkInfo>(`/api/pay/${token}`);
}

export type KkiapayVerifyResult = { alreadyRecorded: boolean; amount?: number };

export function verifyPaymentLink(token: string, transactionId: string) {
  return apiFetch<KkiapayVerifyResult>(`/api/pay/${token}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId }),
  });
}
