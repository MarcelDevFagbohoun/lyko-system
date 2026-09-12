/**
 * Étape 11 (mode hors-ligne) — petite couche IndexedDB, sans dépendance
 * externe (cohérent avec le reste du projet : pas d'ORM côté backend non
 * plus). Deux magasins :
 *   - `getCache` : dernière réponse connue de chaque GET (clé = URL complète),
 *     pour que les pages déjà visitées restent consultables hors-ligne.
 *   - `mutationQueue` : actions d'écriture mises en attente quand le réseau
 *     est indisponible (ex. paiement de loyer, plainte) — rejouées au retour
 *     de la connexion. Volontairement limité à une liste blanche d'actions
 *     sûres (décision explicite, étape 11) : tout ce qui crée une entité à
 *     code auto-généré côté serveur (bien, locataire, bail, propriétaire...)
 *     reste bloqué hors-ligne, jamais mis en file.
 */

const DB_NAME = "lyko-offline";
const DB_VERSION = 1;
export const GET_CACHE_STORE = "getCache";
export const MUTATION_QUEUE_STORE = "mutationQueue";

export type QueueItemKind = "rent_payment" | "complaint";
export type QueueItemStatus = "pending" | "syncing" | "failed";

export type QueueItem = {
  id: number;
  kind: QueueItemKind;
  method: string;
  path: string;
  body: Record<string, unknown>;
  /** Contexte lisible pour l'UI (ex. nom du locataire, montant). */
  summary: string;
  createdAt: string;
  status: QueueItemStatus;
  error?: string;
};

function isIndexedDbAvailable() {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) return Promise.reject(new Error("IndexedDB indisponible"));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(GET_CACHE_STORE)) {
        db.createObjectStore(GET_CACHE_STORE, { keyPath: "url" });
      }
      if (!db.objectStoreNames.contains(MUTATION_QUEUE_STORE)) {
        db.createObjectStore(MUTATION_QUEUE_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Cache GET ────────────────────────────────────────────────────────────

export async function cacheGet(url: string): Promise<unknown | undefined> {
  try {
    const db = await openDb();
    const tx = db.transaction(GET_CACHE_STORE, "readonly");
    const row = await promisifyRequest(tx.objectStore(GET_CACHE_STORE).get(url) as IDBRequest<{ url: string; body: unknown } | undefined>);
    return row?.body;
  } catch {
    return undefined;
  }
}

export async function cachePut(url: string, body: unknown): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(GET_CACHE_STORE, "readwrite");
    tx.objectStore(GET_CACHE_STORE).put({ url, body, cachedAt: new Date().toISOString() });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Le cache est un confort, jamais une exigence — une écriture échouée
    // (quota, navigation privée...) ne doit jamais faire échouer la lecture.
  }
}

// ── File de mutations ────────────────────────────────────────────────────

export async function queueAdd(item: Omit<QueueItem, "id" | "status" | "createdAt">): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(MUTATION_QUEUE_STORE, "readwrite");
  const full = { ...item, status: "pending" as const, createdAt: new Date().toISOString() };
  const id = await promisifyRequest(tx.objectStore(MUTATION_QUEUE_STORE).add(full) as IDBRequest<number>);
  return id;
}

export async function queueList(): Promise<QueueItem[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(MUTATION_QUEUE_STORE, "readonly");
    const rows = await promisifyRequest(tx.objectStore(MUTATION_QUEUE_STORE).getAll() as IDBRequest<QueueItem[]>);
    return rows.sort((a, b) => a.id - b.id);
  } catch {
    return [];
  }
}

export async function queueUpdate(id: number, patch: Partial<QueueItem>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(MUTATION_QUEUE_STORE, "readwrite");
  const store = tx.objectStore(MUTATION_QUEUE_STORE);
  const existing = await promisifyRequest(store.get(id) as IDBRequest<QueueItem | undefined>);
  if (existing) store.put({ ...existing, ...patch });
}

export async function queueRemove(id: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(MUTATION_QUEUE_STORE, "readwrite");
  tx.objectStore(MUTATION_QUEUE_STORE).delete(id);
}

/**
 * Vide le cache de lecture ET la file d'écriture — appelé à la déconnexion.
 * Sur un poste partagé entre employés, le cache d'un compte ne doit jamais
 * rester consultable par le suivant : les clés de cache ne sont pas
 * scindées par utilisateur/tenant, donc on efface tout au lieu de filtrer.
 * (Limite assumée : un crash/fermeture brutale sans déconnexion propre
 * laisse le cache en place jusqu'à la prochaine vraie déconnexion.)
 */
export async function clearOfflineData(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([GET_CACHE_STORE, MUTATION_QUEUE_STORE], "readwrite");
    tx.objectStore(GET_CACHE_STORE).clear();
    tx.objectStore(MUTATION_QUEUE_STORE).clear();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Pas d'IndexedDB (navigation privée stricte, etc.) : rien à vider.
  }
}
