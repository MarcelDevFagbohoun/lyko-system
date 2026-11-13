import { API_URL } from "@/lib/api/client";

/**
 * Signale au serveur un écran en erreur (suivi des erreurs du back-office, demande utilisateur
 * 2026-11-13) — voir backend `routes/clientErrors.js`. Jamais bloquant, jamais levant : un
 * signalement qui échoue ne doit rien changer pour l'utilisateur.
 *
 * Borné par onglet : une même erreur n'est envoyée qu'une fois, et 5 erreurs distinctes au plus —
 * une boucle de rendu défaillante ne doit pas inonder le serveur.
 */
const sent = new Set<string>();
const MAX_PER_TAB = 5;

export function reportClientError(error: unknown, accessToken?: string | null) {
  try {
    if (typeof window === "undefined") return;
    const message = (error instanceof Error ? error.message : String(error ?? "")).slice(0, 500).trim();
    if (!message || sent.has(message) || sent.size >= MAX_PER_TAB) return;
    sent.add(message);
    const stack = error instanceof Error && error.stack ? error.stack.slice(0, 8000) : undefined;
    // Chemin seul : jamais les paramètres d'URL (peuvent contenir un jeton de portail ou un téléphone).
    const page = window.location.pathname.slice(0, 300);
    void fetch(`${API_URL}/api/client-errors`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ message, stack, page }),
    }).catch(() => {});
  } catch {
    /* rien : le signalement est un plus, jamais une source d'erreur */
  }
}
