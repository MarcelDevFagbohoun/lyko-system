import { apiFetch, type Actor } from "./client";

export type ComplaintCategory = "plomberie" | "electricite" | "serrurerie" | "climatisation" | "maconnerie" | "autre";
export type ComplaintPriority = "normale" | "urgente";
export type ComplaintStatus = "ouverte" | "en_cours" | "resolue" | "fermee";

export type Complaint = {
  id: number;
  code: string;
  category: ComplaintCategory;
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
};

export function getComplaintsMeta(accessToken: string) {
  return apiFetch<{
    categories: { key: ComplaintCategory; label: string }[];
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
  return apiFetch<{ complaint: Complaint }>(`/api/complaints/${id}`, { accessToken });
}

export type CreateComplaintInput = {
  leaseId: number;
  category: ComplaintCategory;
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
 * Signaler une plainte — la seconde action autorisée hors-ligne (étape 11,
 * liste blanche explicite avec le paiement de loyer). Sans réseau, mise en
 * file (IndexedDB) et rejouée automatiquement au retour de la connexion.
 * Les photos ne peuvent pas être mises en file (pas de support de fichiers
 * dans la file JSON) : hors-ligne, la plainte part sans photo — à ajouter
 * après coup une fois synchronisée, si besoin.
 */
export async function createComplaint(accessToken: string, input: CreateComplaintInput): Promise<CreateComplaintResult> {
  const { photos, ...rest } = input;
  try {
    const fd = new FormData();
    fd.append("leaseId", String(rest.leaseId));
    fd.append("category", rest.category);
    fd.append("title", rest.title);
    if (rest.description) fd.append("description", rest.description);
    fd.append("priority", rest.priority);
    if (rest.reportedAt) fd.append("reportedAt", rest.reportedAt);
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
        category: rest.category,
        title: rest.title,
        priority: rest.priority,
      };
      if (rest.description) body.description = rest.description;
      if (rest.reportedAt) body.reportedAt = rest.reportedAt;
      await enqueueMutation({
        kind: "complaint",
        method: "POST",
        path: "/api/complaints",
        body,
        summary: `Plainte — ${rest.title}`,
      });
      return { queued: true, complaintId: null, code: null };
    }
    throw err;
  }
}

export type UpdateComplaintInput = Partial<{
  category: ComplaintCategory;
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

export function updateComplaintStatus(
  accessToken: string,
  id: number,
  input: { status: ComplaintStatus; resolutionNote?: string },
) {
  return apiFetch<{ complaint: Complaint }>(`/api/complaints/${id}/status`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
