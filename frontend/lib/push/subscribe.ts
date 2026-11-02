import { fetchVapidPublicKey, subscribePush, unsubscribePush } from "@/lib/api/push";

/** Le navigateur veut la clé VAPID en Uint8Array, l'API nous la donne en base64url. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export type PushSupport = "unsupported" | "denied" | "subscribed" | "available";

/** État actuel, sans rien demander à l'utilisateur (pour afficher le bon bouton). */
export async function getPushState(): Promise<PushSupport> {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return "available";
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? "subscribed" : "available";
}

/**
 * Active les notifications push pour cet appareil : demande la permission au
 * navigateur, s'abonne auprès du service de push, puis enregistre
 * l'abonnement côté serveur. Retourne false si l'utilisateur refuse ou si le
 * navigateur ne supporte pas le push (Safari iOS hors PWA installée, etc.).
 */
export async function enablePush(accessToken: string): Promise<boolean> {
  const state = await getPushState();
  if (state === "unsupported" || state === "denied") return false;

  const { configured, publicKey } = await fetchVapidPublicKey();
  if (!configured || !publicKey) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  await subscribePush(accessToken, subscription.toJSON() as PushSubscriptionJSON);
  return true;
}

/** Désactive les notifications push pour cet appareil (et seulement celui-ci). */
export async function disablePush(accessToken: string): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await unsubscribePush(accessToken, endpoint);
}
