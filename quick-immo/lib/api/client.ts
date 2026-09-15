export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Cabinet dont ce site affiche les biens — Quick Immo est scopé à UN seul
// cabinet pour l'instant (celui-ci relié à Lyko System), pas un agrégateur
// multi-cabinets. Configurable par variable d'environnement pour ne pas
// coder l'id en dur si un jour un autre cabinet a son propre déploiement.
export const TENANT_ID = Number(process.env.NEXT_PUBLIC_TENANT_ID ?? "8");

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
 * Wrapper fetch pour l'API Lyko System, côté Quick Immo (site externe) :
 * pas de cookie de session (les comptes du grand public n'ont pas de
 * refresh token httpOnly, voir backend `utils/jwt.js` signMarketplaceToken)
 * — le jeton, quand il y en a un, part en en-tête `Authorization`.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { accessToken, headers, ...rest } = options;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(res.status, body?.error || `Erreur ${res.status}`, body?.details);
  }
  return body as T;
}
