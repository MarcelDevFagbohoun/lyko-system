/**
 * Chiffrement du cache hors-ligne (audit sécurité, étape 49/50) — AES-GCM
 * 256 bits via l'API Web Crypto native (aucune dépendance).
 *
 * Choix explicite de l'utilisateur sur la gestion de la clé, entre deux
 * options présentées : clé dans `localStorage` (persistante mais lisible par
 * tout JS de la même origine) OU clé UNIQUEMENT en mémoire (protection plus
 * forte contre une extraction brute des fichiers du navigateur — appareil
 * volé, copie forensique du profil — mais perdue à tout rechargement de la
 * page, pas seulement à la fermeture de l'onglet). L'utilisateur a choisi la
 * seconde option EN CONNAISSANCE DE CAUSE : la clé ne touche jamais le
 * disque (ni `localStorage`, ni `sessionStorage`, ni IndexedDB), donc toute
 * donnée déjà chiffrée avec une clé précédente devient définitivement
 * illisible dès qu'une nouvelle clé est générée — en particulier la file de
 * mutations en attente (`mutationQueue`, paiements/plaintes pas encore
 * synchronisés) : un paiement mis en file puis un rechargement de page AVANT
 * le retour du réseau fait perdre ce paiement pour de bon. Seul le cache de
 * LECTURE (`getCache`) est sans conséquence réelle en cas de perte (il ne
 * fait que réafficher une page déjà visitée hors-ligne — une entrée illisible
 * est simplement traitée comme absente, voir `db.ts`).
 */

let sessionKey: CryptoKey | null = null;
let sessionKeyPromise: Promise<CryptoKey> | null = null;

function isWebCryptoAvailable() {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

/** Génère la clé de cette session UNE SEULE FOIS (au premier besoin), jamais persistée. */
function getOrCreateKey(): Promise<CryptoKey> {
  if (sessionKey) return Promise.resolve(sessionKey);
  if (sessionKeyPromise) return sessionKeyPromise;
  sessionKeyPromise = crypto.subtle
    .generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
    .then((key) => {
      sessionKey = key;
      return key;
    });
  return sessionKeyPromise;
}

function bufToBase64(buf: ArrayBuffer): string {
  let binary = "";
  new Uint8Array(buf).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Force une NOUVELLE clé au prochain besoin — appelée à la déconnexion
 * (`clearOfflineData`, poste partagé entre employés) : la base est déjà
 * entièrement vidée à ce moment-là, donc rien à re-déchiffrer avec l'ancienne
 * clé, mais on ne réutilise jamais la même clé d'un contexte de session à
 * l'autre par principe (défense en profondeur).
 */
export function resetSessionKey(): void {
  sessionKey = null;
  sessionKeyPromise = null;
}

export type EncryptedPayload = { iv: string; data: string };

/** Chiffre une valeur JSON-sérialisable. IV aléatoire à chaque appel (jamais réutilisé avec la même clé). */
export async function encryptValue(value: unknown): Promise<EncryptedPayload> {
  if (!isWebCryptoAvailable()) throw new Error("Web Crypto indisponible");
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: bufToBase64(iv.buffer), data: bufToBase64(cipher) };
}

/**
 * Déchiffre une valeur. Renvoie `undefined` (jamais ne lève) si la clé de
 * cette session ne correspond pas à celle utilisée pour chiffrer — le cas
 * normal après un rechargement de page, la clé précédente est perdue.
 */
export async function decryptValue<T = unknown>(payload: EncryptedPayload): Promise<T | undefined> {
  if (!isWebCryptoAvailable()) return undefined;
  try {
    const key = await getOrCreateKey();
    const iv = base64ToBuf(payload.iv);
    const cipher = base64ToBuf(payload.data);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return undefined;
  }
}
