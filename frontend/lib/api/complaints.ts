import { apiFetch, type Actor } from "./client";
import { newIdempotencyKey } from "@/lib/utils";

export type ComplaintPriority = "normale" | "urgente";
export type ComplaintStatus = "non_resolue" | "resolue";

export type Complaint = {
  id: number;
  code: string;
  title: string;
  description: string | null;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  photoUrls: string[];
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: Actor;
  reportedAt: string;
  createdBy: Actor;
  createdAt: string;
  lease: { id: number; status: "active" | "ended" };
  renter: { id: number; firstName: string; lastName: string; phone: string };
  unit: { id: number; code: string; designationLabel: string };
  property: { id: number; code: string; address: string | null };
  /** Dernier événement du journal (signalement, statut ou commentaire). */
  lastActivityAt: string;
  /** Le dernier message vient du locataire : l'équipe doit lui répondre. */
  lastByTenant: boolean;
};

export type ComplaintEvent = {
  id: number;
  type: "reported" | "status_changed" | "comment";
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus | null;
  body: string | null;
  /** "internal" : réservé à l'équipe ; "tenant" : visible du locataire sur sa page de suivi. */
  visibility: "tenant" | "internal";
  /** Reconstitué pour une plainte antérieure au journal : la date est approximative. */
  isEstimated: boolean;
  createdAt: string;
  author: { name: string; role: string; roleLabel: string } | null;
};

export type ComplaintDates = { reportedAt: string; lastActivityAt: string; resolvedAt: string | null };

export function getComplaintsMeta(accessToken: string) {
  return apiFetch<{
    priorities: ComplaintPriority[];
    statuses: ComplaintStatus[];
  }>("/api/complaints/meta", { accessToken });
}

export function listComplaints(
  accessToken: string,
  filters?: { status?: ComplaintStatus; q?: string; leaseId?: number },
) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.leaseId) params.set("leaseId", String(filters.leaseId));
  const qs = params.toString();
  return apiFetch<{ complaints: Complaint[] }>(`/api/complaints${qs ? `?${qs}` : ""}`, { accessToken });
}

export function getComplaint(accessToken: string, id: number) {
  return apiFetch<{ complaint: Complaint; events: ComplaintEvent[]; dates: ComplaintDates }>(`/api/complaints/${id}`, { accessToken });
}

export type ComplaintEventInput = {
  comment?: string;
  visibility?: "tenant" | "internal";
  status?: ComplaintStatus;
  resolutionNote?: string;
};

export type AddComplaintEventResult =
  | { queued: false; complaint: Complaint; events: ComplaintEvent[]; dates: ComplaintDates }
  | { queued: true };

/**
 * Commentaire (interne par défaut) et/ou changement de statut. Autorisé
 * hors-ligne (étape 11, extension) : sans réseau, mis en file (IndexedDB) et
 * rejoué automatiquement au retour de la connexion. Ce journal n'étant pas
 * mis à jour optimiste (pas de version locale provisoire de l'événement), la
 * mise en file n'affiche pas tout de suite le commentaire dans le fil — il
 * apparaît une fois synchronisé, comme les autres actions en attente.
 */
export async function addComplaintEvent(
  accessToken: string,
  id: number,
  input: ComplaintEventInput,
): Promise<AddComplaintEventResult> {
  const path = `/api/complaints/${id}/events`;
  try {
    const result = await apiFetch<{ complaint: Complaint; events: ComplaintEvent[]; dates: ComplaintDates }>(path, {
      method: "POST",
      accessToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return { queued: false, ...result };
  } catch (err) {
    const { isNetworkError, enqueueMutation } = await import("@/lib/offline/queue");
    if (isNetworkError(err)) {
      await enqueueMutation({
        kind: "complaint_event",
        method: "POST",
        path,
        body: input,
        summary: input.status ? `Suivi plainte — statut : ${input.status}` : "Suivi plainte — commentaire",
      });
      return { queued: true };
    }
    throw err;
  }
}

/** Chemin (`/suivi/…`) de la page de suivi du locataire ; identique à chaque appel. */
export function getComplaintTrackingLink(accessToken: string, id: number) {
  return apiFetch<{ path: string }>(`/api/complaints/${id}/tracking-link`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export type CreateComplaintInput = {
  leaseId: number;
  title: string;
  description?: string;
  priority: ComplaintPriority;
  reportedAt?: string;
  photos?: File[];
};

export type CreateComplaintResult =
  | { queued: false; complaintId: number; code: string }
  | { queued: true; complaintId: null; code: null };

/**
 * Signaler une plainte — autorisée hors-ligne (étape 11, liste blanche
 * explicite). Sans réseau, mise en file (IndexedDB) et rejouée
 * automatiquement au retour de la connexion — PHOTOS INCLUSES : chacune est
 * encodée en base64 pour tenir dans le JSON chiffré de la file (voir
 * `lib/offline/files.ts`), puis reconstruite en `File` et renvoyée en
 * multipart au moment du vrai envoi (voir `lib/offline/queue.ts`).
 */
export async function createComplaint(accessToken: string, input: CreateComplaintInput): Promise<CreateComplaintResult> {
  const { photos, ...rest } = input;
  // Une seule clé pour CET envoi, réutilisée telle quelle si la requête part
  // en file hors-ligne ci-dessous : si la tentative en direct avait en fait
  // réussi côté serveur mais que sa réponse s'est perdue (coupure juste après),
  // le rejeu automatique de la file avec la MÊME clé revient en 409 « déjà
  // enregistré » plutôt que de créer un doublon (voir `claimIdempotencyKey`
  // côté serveur, et `lib/offline/queue.ts` qui traite déjà ce 409 précis
  // comme un succès silencieux).
  const idempotencyKey = newIdempotencyKey();
  try {
    const fd = new FormData();
    fd.append("leaseId", String(rest.leaseId));
    fd.append("title", rest.title);
    if (rest.description) fd.append("description", rest.description);
    fd.append("priority", rest.priority);
    if (rest.reportedAt) fd.append("reportedAt", rest.reportedAt);
    fd.append("idempotencyKey", idempotencyKey);
    photos?.forEach((f) => fd.append("photos", f));
    const result = await apiFetch<{ complaintId: number; code: string }>("/api/complaints", {
      method: "POST",
      accessToken,
      body: fd,
    });
    return { queued: false, ...result };
  } catch (err) {
    const { isNetworkError, enqueueMutation } = await import("@/lib/offline/queue");
    if (isNetworkError(err)) {
      // Le rejeu envoie exactement la même forme que le POST en ligne : les
      // champs optionnels vides sont OMIS, jamais mis à `null` — le validateur
      // serveur (`createComplaintSchema`) n'accepte pas `null` pour
      // `description`/`reportedAt`, ce qui faisait échouer la synchro (400).
      const body: Record<string, unknown> = {
        leaseId: rest.leaseId,
        title: rest.title,
        priority: rest.priority,
        idempotencyKey,
      };
      if (rest.description) body.description = rest.description;
      if (rest.reportedAt) body.reportedAt = rest.reportedAt;
      if (photos && photos.length > 0) {
        const { encodeFileToBase64 } = await import("@/lib/offline/files");
        body.photosBase64 = await Promise.all(photos.map(encodeFileToBase64));
      }
      await enqueueMutation({
        kind: "complaint",
        method: "POST",
        path: "/api/complaints",
        body,
        summary: `Plainte — ${rest.title}${photos && photos.length > 0 ? ` (${photos.length} photo${photos.length > 1 ? "s" : ""})` : ""}`,
      });
      return { queued: true, complaintId: null, code: null };
    }
    throw err;
  }
}

export type UpdateComplaintInput = Partial<{
  title: string;
  description: string;
  priority: ComplaintPriority;
}>;

export function updateComplaint(accessToken: string, id: number, input: UpdateComplaintInput) {
  return apiFetch<{ complaint: Complaint }>(`/api/complaints/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * Bascule le statut de la plainte (résolue/non résolue). Autorisé hors-ligne
 * (étape 11, extension) : sans réseau, mis en file (IndexedDB) et rejoué
 * automatiquement au retour de la connexion. Comme `addComplaintEvent`, pas
 * de mise à jour optimiste locale — l'appelant doit traiter `queued: true`.
 */
export async function updateComplaintStatus(
  accessToken: string,
  id: number,
  input: { status: ComplaintStatus; resolutionNote?: string },
): Promise<{ queued: boolean; complaint: Complaint | null }> {
  const path = `/api/complaints/${id}/status`;
  try {
    const result = await apiFetch<{ complaint: Complaint }>(path, {
      method: "PATCH",
      accessToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return { queued: false, ...result };
  } catch (err) {
    const { isNetworkError, enqueueMutation } = await import("@/lib/offline/queue");
    if (isNetworkError(err)) {
      await enqueueMutation({
        kind: "complaint_event",
        method: "PATCH",
        path,
        body: input,
        summary: `Suivi plainte — statut : ${input.status}`,
      });
      return { queued: true, complaint: null };
    }
    throw err;
  }
}
