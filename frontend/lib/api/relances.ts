import { apiFetch, type Actor } from "./client";

export type RelanceEntityType = "bail" | "charge";

export type Relance = {
  id: number;
  entityType: RelanceEntityType;
  entityId: number;
  sentAt: string;
  sentBy: Actor;
  outcomeNote: string | null;
  outcomeRecordedAt: string | null;
  outcomeRecordedBy: Actor;
};

const json = { "Content-Type": "application/json" };

/**
 * Enregistre l'envoi d'une relance (date du jour, auteur) — à appeler en plus
 * d'ouvrir le lien WhatsApp. Autorisée hors-ligne (étape 11, extension) :
 * sans réseau, mise en file (IndexedDB) et rejouée automatiquement au retour
 * de la connexion — l'essentiel (WhatsApp) marche déjà hors-ligne de son
 * côté, seule la trace écrite ici attendait le réseau jusqu'ici.
 */
export async function recordRelance(
  accessToken: string,
  entityType: RelanceEntityType,
  entityId: number,
): Promise<{ queued: boolean; relance: Relance | null }> {
  const path = "/api/relances";
  try {
    const result = await apiFetch<{ relance: Relance }>(path, {
      method: "POST",
      accessToken,
      headers: json,
      body: JSON.stringify({ entityType, entityId }),
    });
    return { queued: false, ...result };
  } catch (err) {
    const { isNetworkError, enqueueMutation } = await import("@/lib/offline/queue");
    if (isNetworkError(err)) {
      await enqueueMutation({
        kind: "relance",
        method: "POST",
        path,
        body: { entityType, entityId },
        summary: `Relance — ${entityType === "bail" ? "loyer" : "facture"}`,
      });
      return { queued: true, relance: null };
    }
    throw err;
  }
}

/** Historique des relances d'UN dossier précis (bail ou facture de charge). */
export function listRelances(accessToken: string, entityType: RelanceEntityType, entityId: number) {
  return apiFetch<{ relances: Relance[] }>(
    `/api/relances?entityType=${entityType}&entityId=${entityId}`,
    { accessToken },
  );
}

/** Fil complet (loyer + charges) pour la fiche locataire. */
export function listRelancesForLease(accessToken: string, leaseId: number) {
  return apiFetch<{ relances: Relance[] }>(`/api/relances/by-lease/${leaseId}`, { accessToken });
}

/** Ajoute ou corrige le retour (réponse du locataire, suite donnée) d'une relance déjà envoyée. */
export function setRelanceOutcome(accessToken: string, relanceId: number, note: string) {
  return apiFetch<{ relance: Relance }>(`/api/relances/${relanceId}`, {
    method: "PATCH",
    accessToken,
    headers: json,
    body: JSON.stringify({ note }),
  });
}
