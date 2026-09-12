export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Attribution « qui a fait quoi » — DG, comptable ou agent. Renvoyée par
 * l'API pour toute opération tracée (création, paiement, versement, état
 * des lieux, plainte...) ; null quand l'enregistrement est antérieur à ce
 * suivi (jamais d'auteur inventé).
 */
export type Actor = { name: string; role: "dg" | "comptable" | "agent"; roleLabel: string } | null;

export class ApiError extends Error {
  status: number;
  details?: Record<string, string[]>;

  constructor(status: number, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type ApiFetchOptions = Omit<RequestInit, "body"> & {
  accessToken?: string;
  body?: BodyInit | null;
};

/**
 * Wrapper fetch pour l'API Lyko System : envoie toujours les cookies
 * (refresh token httpOnly) et normalise les erreurs en `ApiError`.
 * Ne fixe PAS de Content-Type par défaut : laisser FormData définir le
 * sien (boundary) ; passer explicitement application/json pour du JSON.
 *
 * Mode hors-ligne (étape 11) : chaque lecture (GET) réussie est mise en
 * cache (IndexedDB, par URL complète) ; si le réseau est injoignable, on
 * sert la dernière réponse connue plutôt qu'une page en erreur — les pages
 * déjà visitées restent consultables hors-ligne. Les écritures (POST/PATCH/
 * DELETE) ne sont jamais mises en cache ni rejouées automatiquement ici :
 * seule une liste blanche d'actions sûres passe par la file d'attente
 * dédiée (`lib/offline/queue.ts`), à l'appel de chaque fonction concernée.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { accessToken, headers, ...rest } = options;
  const method = (rest.method ?? "GET").toUpperCase();
  const url = `${API_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      credentials: "include",
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
    });
  } catch (networkErr) {
    if (method === "GET") {
      const { cacheGet } = await import("@/lib/offline/db");
      const cached = await cacheGet(url);
      if (cached !== undefined) return cached as T;
    }
    throw networkErr;
  }

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(res.status, body?.error || `Erreur ${res.status}`, body?.details);
  }

  if (method === "GET") {
    const { cachePut } = await import("@/lib/offline/db");
    cachePut(url, body);
  }

  return body as T;
}

/**
 * Récupère un document binaire (PDF) protégé par Bearer token et l'ouvre
 * dans un nouvel onglet. `<a href>` ne peut pas porter l'en-tête
 * Authorization, d'où ce fetch + URL objet local.
 */
export async function openAuthenticatedPdf(path: string, accessToken: string) {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error || `Erreur ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
