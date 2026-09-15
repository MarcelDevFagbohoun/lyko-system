import { apiFetch } from "./client";
import type { ActivityEntry } from "./dashboard";

// Historique personnel (étape 18, comptable/agent) : même forme d'entrée que
// le Journal d'activité DG (`lib/api/dashboard.ts`), réutilisée telle quelle —
// seule la source côté serveur diffère (filtrée à l'auteur connecté).
export function getMyHistory(accessToken: string, limit?: number) {
  const qs = limit ? `?limit=${limit}` : "";
  return apiFetch<{ entries: ActivityEntry[] }>(`/api/history${qs}`, { accessToken });
}

export type { ActivityEntry };
