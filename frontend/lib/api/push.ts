import { apiFetch } from "./client";

export type VapidKeyResponse = { configured: boolean; publicKey: string | null };

const json = { "Content-Type": "application/json" };

export function fetchVapidPublicKey() {
  return apiFetch<VapidKeyResponse>("/api/push/vapid-public-key");
}

export function subscribePush(accessToken: string, subscription: PushSubscriptionJSON) {
  return apiFetch<{ subscribed: true }>("/api/push/subscribe", {
    method: "POST",
    accessToken,
    headers: json,
    body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }),
  });
}

export function unsubscribePush(accessToken: string, endpoint: string) {
  return apiFetch<{ subscribed: false }>("/api/push/unsubscribe", {
    method: "POST",
    accessToken,
    headers: json,
    body: JSON.stringify({ endpoint }),
  });
}
