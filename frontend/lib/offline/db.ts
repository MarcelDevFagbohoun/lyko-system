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
 *
 * Étape 49/50 (audit sécurité) — le contenu potentiellement sensible
 * (`body` des deux magasins, `summary` de la file — noms/montants lisibles)
 * est chiffré au repos (AES-GCM, voir `crypto.ts`) : `EncryptedPayload` sur
 * le disque, jamais en clair. Entièrement transparent pour les appelants
 * (`cacheGet`/`queueList` renvoient toujours du JSON déchiffré) — seule
 * cette couche connaît le format chiffré.
 */

import { encryptValue, decryptValue, resetSessionKey, type EncryptedPayload } from "./crypto";

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

/** Forme réellement stockée en base — `body`/`summary` chiffrés, le reste en clair (métadonnées de synchro, non sensibles). */
type StoredQueueItem = Omit<QueueItem, "body" | "summary"> & { encBody: EncryptedPayload; encSummary: EncryptedPayload };
type StoredCacheRow = { url: string; encBody: EncryptedPayload; cachedAt: string };

async function toStoredQueueItem(item: Omit<QueueItem, "id"> & { id?: number }): Promise<Omit<StoredQueueItem, "id"> & { id?: number }> {
  const { body, summary, ...rest } = item;
  const [encBody, encSummary] = await Promise.all([encryptValue(body), encryptValue(summary)]);
  return { ...rest, encBody, encSummary };
}

async function fromStoredQueueItem(row: StoredQueueItem): Promise<QueueItem | undefined> {
  const { encBody, encSummary, ...rest } = row;
  const [body, summary] = await Promise.all([
    decryptValue<Record<string, unknown>>(encBody),
    decryptValue<string>(encSummary),
  ]);
  // Clé de session perdue (rechargement de page) : cette entrée est
  // définitivement illisible, jamais affichée comme une file vide de sens.
  if (body === undefined || summary === undefined) return undefined;
  return { ...rest, body, summary };
}

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
    const row = await promisifyRequest(tx.objectStore(GET_CACHE_STORE).get(url) as IDBRequest<StoredCacheRow | undefined>);
    if (!row) return undefined;
    // Clé de session perdue (rechargement de page) : traité comme une
    // entrée absente, jamais une erreur — cette page sera juste rechargée
    // depuis le réseau au prochain accès en ligne.
    return await decryptValue(row.encBody);
  } catch {
    return undefined;
  }
}

export async function cachePut(url: string, body: unknown): Promise<void> {
  try {
    const encBody = await encryptValue(body);
    const db = await openDb();
    const tx = db.transaction(GET_CACHE_STORE, "readwrite");
    tx.objectStore(GET_CACHE_STORE).put({ url, encBody, cachedAt: new Date().toISOString() } satisfies StoredCacheRow);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Le cache est un confort, jamais une exigence — une écriture échouée
    // (quota, navigation privée, Web Crypto indisponible...) ne doit jamais
    // faire échouer la lecture.
  }
}

// ── File de mutations ────────────────────────────────────────────────────

export async function queueAdd(item: Omit<QueueItem, "id" | "status" | "createdAt">): Promise<number> {
  const stored = await toStoredQueueItem({ ...item, status: "pending" as const, createdAt: new Date().toISOString() });
  const db = await openDb();
  const tx = db.transaction(MUTATION_QUEUE_STORE, "readwrite");
  const id = await promisifyRequest(tx.objectStore(MUTATION_QUEUE_STORE).add(stored) as IDBRequest<number>);
  return id;
}

export async function queueList(): Promise<QueueItem[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(MUTATION_QUEUE_STORE, "readonly");
    const rows = await promisifyRequest(tx.objectStore(MUTATION_QUEUE_STORE).getAll() as IDBRequest<StoredQueueItem[]>);
    const decrypted = await Promise.all(rows.map((row) => fromStoredQueueItem(row)));
    const unreadable = rows.filter((_, i) => decrypted[i] === undefined);
    if (unreadable.length > 0) {
      // Irrécupérable (clé de session perdue) : nettoyage plutôt que de
      // laisser une entrée fantôme indéfiniment — voir crypto.ts pour le
      // compromis accepté (clé jamais persistée).
      // eslint-disable-next-line no-console
      console.warn(`${unreadable.length} action(s) hors-ligne en attente illisible(s) après rechargement de page — perdue(s).`);
      const cleanupTx = db.transaction(MUTATION_QUEUE_STORE, "readwrite");
      unreadable.forEach((row) => cleanupTx.objectStore(MUTATION_QUEUE_STORE).delete(row.id));
    }
    return decrypted.filter((item): item is QueueItem => item !== undefined).sort((a, b) => a.id - b.id);
  } catch {
    return [];
  }
}

export async function queueUpdate(id: number, patch: Partial<QueueItem>): Promise<void> {
  const db = await openDb();
  // Lecture dans sa propre transaction : une opération Web Crypto (async,
  // pas garantie de rester dans la fenêtre de vie d'une transaction
  // IndexedDB déjà ouverte) s'intercale avant l'écriture ci-dessous — d'où
  // deux transactions séparées plutôt qu'un `get` puis `put` sur la même.
  const readTx = db.transaction(MUTATION_QUEUE_STORE, "readonly");
  const existing = await promisifyRequest(
    readTx.objectStore(MUTATION_QUEUE_STORE).get(id) as IDBRequest<StoredQueueItem | undefined>,
  );
  if (!existing) return;

  const { body: patchBody, summary: patchSummary, ...restPatch } = patch;
  const encBody = patchBody !== undefined ? await encryptValue(patchBody) : existing.encBody;
  const encSummary = patchSummary !== undefined ? await encryptValue(patchSummary) : existing.encSummary;

  const writeTx = db.transaction(MUTATION_QUEUE_STORE, "readwrite");
  writeTx.objectStore(MUTATION_QUEUE_STORE).put({ ...existing, ...restPatch, encBody, encSummary });
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
  } finally {
    resetSessionKey();
  }
}
