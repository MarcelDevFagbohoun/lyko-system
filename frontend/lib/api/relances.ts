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

/** Enregistre l'envoi d'une relance (date du jour, auteur) — à appeler en plus d'ouvrir le lien WhatsApp. */
export function recordRelance(accessToken: string, entityType: RelanceEntityType, entityId: number) {
  return apiFetch<{ relance: Relance }>("/api/relances", {
    method: "POST",
    accessToken,
    headers: json,
    body: JSON.stringify({ entityType, entityId }),
  });
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
