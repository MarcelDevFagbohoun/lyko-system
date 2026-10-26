/**
 * Adresse secrète du back-office.
 *
 * Sans configuration, le back-office reste à `/admin` (développement). Quand `ADMIN_PATH` est défini (production),
 * il n'est joignable QUE par cette adresse : `/admin` répond « page introuvable ». Ce n'est pas une protection à elle
 * seule (la connexion et la double authentification restent indispensables) : elle évite que le premier robot venu
 * trouve la page de connexion en essayant `/admin`.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{9,60}$/;

/** Retourne l'adresse secrète nettoyée, ou null si absente ou trop faible (10 caractères minimum, a-z 0-9 et tirets). */
export function parseAdminSlug(raw: string | undefined | null): string | null {
  const v = (raw ?? "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  return SLUG_RE.test(v) ? v : null;
}

export type AdminRouting = "serve-admin" | "hide" | "pass";

/** En-tête interne posé par le middleware sur sa propre réécriture (valeur = l'adresse secrète, inconnue d'un visiteur). */
export const ADMIN_GATE_HEADER = "x-admin-gate";

/**
 * Décide quoi faire d'un chemin : servir la page admin (adresse secrète), la cacher (`/admin`), ou laisser passer.
 * `gate` : valeur de l'en-tête interne. Le serveur de production repasse la requête réécrite (`/admin`) dans le
 * middleware ; sans ce jeton elle serait cachée à son tour.
 */
export function adminRouting(pathname: string, slug: string | null, gate?: string | null): AdminRouting {
  if (!slug) return "pass";
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === `/${slug}`) return "serve-admin";
  if (p === "/admin" || p.startsWith("/admin/")) return gate === slug ? "pass" : "hide";
  return "pass";
}
