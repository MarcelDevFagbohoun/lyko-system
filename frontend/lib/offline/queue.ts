import { ApiError } from "@/lib/api/client";
import { queueAdd, queueList, queueUpdate, queueRemove, type QueueItem, type QueueItemKind } from "./db";

/**
 * Étape 11 — moteur de synchronisation de la file d'écriture hors-ligne.
 * Rejoue les actions en attente dans l'ordre dès que la connexion revient.
 * Jamais de résolution automatique de conflit : un échec serveur (mois
 * clôturé entre-temps, bail terminé, etc.) marque l'action `failed` avec le
 * message exact du serveur et l'affiche à l'utilisateur pour une décision
 * manuelle (réessayer ou abandonner) — décision explicite de l'étape 11.
 */

type Listener = (items: QueueItem[]) => void;
const listeners = new Set<Listener>();
let syncing = false;

async function notify() {
  const items = await queueList();
  listeners.forEach((l) => l(items));
}

/** S'abonne aux changements de la file (nombre d'éléments, statuts). Renvoie une fonction de désinscription. */
export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  queueList().then(listener);
  return () => listeners.delete(listener);
}

export function isSyncing() {
  return syncing;
}

/** Ajoute une action à la file (hors-ligne, ou réseau injoignable) et notifie les abonnés. */
export async function enqueueMutation(item: {
  kind: QueueItemKind;
  method: string;
  path: string;
  body: Record<string, unknown>;
  summary: string;
}): Promise<number> {
  const id = await queueAdd(item);
  await notify();
  return id;
}

/** Vrai si `err` signale une vraie coupure réseau (pas une erreur applicative renvoyée par le serveur). */
export function isNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError);
}

/**
 * Rejoue la file dans l'ordre. S'arrête au premier échec réseau (la
 * connexion n'est probablement pas vraiment revenue) mais continue après un
 * échec applicatif (ne bloque pas les actions suivantes à cause d'une seule
 * qui ne passera jamais).
 */
export async function processQueue(accessToken: string | null): Promise<void> {
  if (syncing || !accessToken) return;
  const items = await queueList();
  if (items.length === 0) return;

  syncing = true;
  await notify();
  try {
    for (const item of items) {
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
      await queueUpdate(item.id, { status: "syncing" });
      await notify();
      try {
        const { apiFetch } = await import("@/lib/api/client");
        await apiFetch(item.path, {
          method: item.method,
          accessToken,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.body),
        });
        await queueRemove(item.id);
      } catch (err) {
        if (isNetworkError(err)) {
          await queueUpdate(item.id, { status: "pending" });
          break;
        }
        const message = err instanceof ApiError ? err.message : "Échec de synchronisation";
        await queueUpdate(item.id, { status: "failed", error: message });
      }
      await notify();
    }
  } finally {
    syncing = false;
    await notify();
  }
}

export async function retryQueueItem(id: number, accessToken: string | null) {
  await queueUpdate(id, { status: "pending", error: undefined });
  await notify();
  await processQueue(accessToken);
}

export async function discardQueueItem(id: number) {
  await queueRemove(id);
  await notify();
}

/** À appeler une fois au démarrage de l'appli connectée : rejoue la file au retour du réseau. */
export function startQueueAutoSync(getAccessToken: () => string | null) {
  if (typeof window === "undefined") return () => {};

  const trigger = () => processQueue(getAccessToken());
  trigger(); // au cas où des actions attendaient déjà depuis une session précédente
  window.addEventListener("online", trigger);
  return () => window.removeEventListener("online", trigger);
}
