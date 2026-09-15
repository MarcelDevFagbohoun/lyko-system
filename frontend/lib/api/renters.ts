import { apiFetch, type Actor } from "./client";
import type { PropertyOwner, PropertyTypeKey, UnitDesignationKey } from "./properties";
import type { InspectionCondition } from "@/lib/constants/inspection";

export type PaymentMethod = "especes" | "mobile_money" | "virement" | "cheque";

/** Bien (bâtiment) tel qu'imbriqué dans un bail, avec son propriétaire. */
export type LeaseProperty = {
  id: number;
  code: string;
  owner: PropertyOwner;
  address: string | null;
  type: PropertyTypeKey;
  typeLabel: string;
  levels: number | null;
};

/** Unité locative (le lot loué) telle qu'imbriquée dans un bail. */
export type LeaseUnit = {
  id: number;
  code: string;
  designation: UnitDesignationKey;
  designationLabel: string;
  sonebMeterNumber: string | null;
  sbeeMeterNumber: string | null;
  furnished: boolean;
  property: LeaseProperty;
};

export type Arrears = {
  paidThroughMonth: string | null;
  nextDueMonth: string;
  dueDate: string;
  daysLate: number;
  status: "current" | "late";
};

export type Payment = {
  id: number;
  coversMonth: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  paidAt: string;
  notes: string | null;
  recordedBy: Actor;
  receipt: { id: number; number: string; issuedAt: string } | null;
};

/**
 * Poste d'état des lieux (étape 13, idée n°9 : refonte par zones). `deduction`
 * n'a de sens que sur une fiche de SORTIE (toujours 0, ignorée, sur une
 * fiche d'entrée) — une seule forme, partagée entre entrée et sortie.
 * `key` est stable pour un poste standard, généré côté client pour un poste
 * personnalisé — utilisé pour retrouver le poste (photo) et pour la
 * comparaison automatique entrée/sortie.
 */
export type InspectionItem = {
  key: string;
  label: string;
  custom: boolean;
  condition: InspectionCondition | null;
  comment: string | null;
  photoUrl: string | null;
  deduction: number;
};
export type InspectionZone = { key: string; label: string; custom: boolean; items: InspectionItem[] };
export type InspectionReportStatus = "draft" | "finalized";

export type InspectionReport = {
  id: number;
  status: InspectionReportStatus;
  conductedAt: string;
  zones: InspectionZone[];
  generalNotes: string | null;
  finalizedAt: string | null;
  tenantSignatureUrl: string | null;
  agentSignatureUrl: string | null;
  conductedBy: Actor;
  finalizedBy: Actor;
};

export type MoveInReport = InspectionReport;

/** État des lieux de sortie : même fiche que l'entrée + décompte de caution. */
export type MoveOutReport = InspectionReport & {
  otherDeductionsAmount: number;
  otherDeductionsNote: string | null;
  depositAmount: number;
  totalDeductions: number;
  netRefund: number;
};

export type Lease = {
  id: number;
  monthlyRent: number;
  depositAmount: number;
  depositStatus: "held" | "returned";
  rentDueDay: number;
  startDate: string;
  endDate: string | null;
  status: "active" | "ended";
  unit: LeaseUnit;
  payments: Payment[];
  arrears: Arrears | null;
  moveInReport: MoveInReport | null;
  moveOutReport: MoveOutReport | null;
  createdBy: Actor;
  createdAt: string;
};

export type Renter = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  profession: string | null;
  notes: string | null;
  createdBy: Actor;
  createdAt: string;
  /** Un lien de portail a déjà été généré pour ce locataire (jamais le token lui-même). */
  hasPortalLink: boolean;
  portalLinkCreatedAt: string | null;
};

export type RenterListItem = Renter & { activeLease: Lease | null; arrears: Arrears | null };

export function listRenters(accessToken: string) {
  return apiFetch<{ renters: RenterListItem[] }>("/api/renters", { accessToken });
}

export function getRenter(accessToken: string, id: number) {
  return apiFetch<{ renter: Renter; leases: Lease[] }>(`/api/renters/${id}`, { accessToken });
}

export type CreateRenterInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  profession?: string;
  notes?: string;
  unitId: number;
  // Loyer optionnel : reprend celui de l'unité si omis.
  monthlyRent?: number;
  depositAmount: number;
  rentDueDay: number;
  startDate: string;
};

export function createRenter(accessToken: string, input: CreateRenterInput) {
  // Le lien du portail locataire est généré automatiquement à la création
  // (étape 13, idée n°2) — renvoyé une seule fois ici, comme un mot de passe
  // temporaire ; il faudra passer par `generatePortalLink` (régénérer) pour
  // en obtenir un nouveau si celui-ci est perdu.
  return apiFetch<{ renterId: number; leaseId: number; unitId: number; portalLink: { token: string; path: string } }>(
    "/api/renters",
    {
      method: "POST",
      accessToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export type UpdateRenterInput = Partial<{
  firstName: string;
  lastName: string;
  email: string | null;
  profession: string | null;
  notes: string | null;
}>;

export function updateRenter(accessToken: string, id: number, input: UpdateRenterInput) {
  return apiFetch<{ renter: Renter }>(`/api/renters/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type CreateLeaseInput = Omit<
  CreateRenterInput,
  "firstName" | "lastName" | "phone" | "email" | "profession" | "notes"
>;

export function createLease(accessToken: string, renterId: number, input: CreateLeaseInput) {
  return apiFetch<{ leaseId: number; unitId: number }>(`/api/renters/${renterId}/leases`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function endLease(accessToken: string, leaseId: number, endDate: string) {
  return apiFetch<void>(`/api/leases/${leaseId}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endDate }),
  });
}

export type CreatePaymentInput = {
  /** Facultatif : par défaut le serveur part du prochain mois dû. */
  coversMonth?: string;
  /** Peut couvrir plusieurs mois : le serveur répartit (mois entiers + reste partiel). */
  amount: number;
  paymentMethod: PaymentMethod;
  paidAt: string;
  notes?: string;
};

/** Une écriture créée par un paiement (un mois de loyer, une quittance). */
export type PaymentSplit = {
  paymentId: number;
  coversMonth: string;
  amount: number;
  isPartial: boolean;
  receipt: { id: number; number: string };
};

export type CreatePaymentResult =
  | {
      queued: false;
      monthsCovered: number;
      fullMonths: number;
      partialAmount: number;
      payments: PaymentSplit[];
      /** Compat : premier paiement. */
      paymentId: number;
      receipt: { id: number; number: string };
    }
  | { queued: true; monthsCovered: null; payments: null; paymentId: null; receipt: null };

/**
 * Enregistrer un paiement de loyer — l'une des deux actions autorisées
 * hors-ligne (étape 11, liste blanche explicite) : sans réseau, l'action est
 * mise en file (IndexedDB) au lieu d'échouer, et rejouée automatiquement au
 * retour de la connexion. Aucun ID/numéro de quittance réel tant que ce
 * n'est pas synchronisé — l'appelant doit vérifier `queued` et ne jamais
 * tenter d'ouvrir une quittance PDF pour un paiement encore en attente.
 */
export async function createPayment(
  accessToken: string,
  leaseId: number,
  input: CreatePaymentInput,
): Promise<CreatePaymentResult> {
  const path = `/api/leases/${leaseId}/payments`;
  try {
    const result = await apiFetch<{
      paymentId: number;
      receipt: { id: number; number: string };
      monthsCovered: number;
      fullMonths: number;
      partialAmount: number;
      payments: PaymentSplit[];
    }>(path, {
      method: "POST",
      accessToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return { queued: false, ...result };
  } catch (err) {
    const { isNetworkError, enqueueMutation } = await import("@/lib/offline/queue");
    if (isNetworkError(err)) {
      const body: Record<string, unknown> = {
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        paidAt: input.paidAt,
      };
      if (input.coversMonth) body.coversMonth = input.coversMonth;
      if (input.notes) body.notes = input.notes;
      await enqueueMutation({
        kind: "rent_payment",
        method: "POST",
        path,
        body,
        summary: `Paiement loyer — ${input.amount} FCFA`,
      });
      return { queued: true, monthsCovered: null, payments: null, paymentId: null, receipt: null };
    }
    throw err;
  }
}

export function receiptPdfPath(leaseId: number, paymentId: number) {
  return `/api/leases/${leaseId}/payments/${paymentId}/receipt.pdf`;
}

export function certificatePdfPath(renterId: number) {
  return `/api/renters/${renterId}/certificate.pdf`;
}

// État des lieux (étape 13, idée n°9 : refonte par zones) — cycle
// brouillon → finalisation, partagé entre entrée et sortie (le chemin
// `${kind}-report` change, la forme de la fiche est identique).
export type InspectionReportKind = "move-in" | "move-out";

function inspectionReportPath(kind: InspectionReportKind, leaseId: number) {
  return `/api/leases/${leaseId}/${kind}-report`;
}

export function getMoveInReport(accessToken: string, leaseId: number) {
  return apiFetch<{ report: MoveInReport | null }>(inspectionReportPath("move-in", leaseId), { accessToken });
}

/** Démarre le brouillon (zones/éléments standards) — une fois par bail. */
export function startMoveInReport(accessToken: string, leaseId: number, conductedAt?: string) {
  return apiFetch<{ report: MoveInReport }>(inspectionReportPath("move-in", leaseId), {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conductedAt }),
  });
}

export type UpdateInspectionDraftInput = {
  conductedAt?: string;
  zones: InspectionZone[];
  generalNotes?: string;
};

export function updateMoveInReport(accessToken: string, leaseId: number, input: UpdateInspectionDraftInput) {
  return apiFetch<{ report: MoveInReport }>(inspectionReportPath("move-in", leaseId), {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function finalizeMoveInReport(accessToken: string, leaseId: number, tenantSignature: Blob, agentSignature: Blob) {
  const fd = new FormData();
  fd.append("tenantSignature", tenantSignature, "signature-locataire.png");
  fd.append("agentSignature", agentSignature, "signature-agent.png");
  return apiFetch<{ report: MoveInReport }>(`${inspectionReportPath("move-in", leaseId)}/finalize`, {
    method: "POST",
    accessToken,
    body: fd,
  });
}

export function getMoveOutReport(accessToken: string, leaseId: number) {
  return apiFetch<{ report: MoveOutReport | null; arrears: Arrears | null }>(
    inspectionReportPath("move-out", leaseId),
    { accessToken },
  );
}

/** Démarre le brouillon, amorcé depuis la fiche d'entrée si elle existe (comparaison automatique). */
export function startMoveOutReport(accessToken: string, leaseId: number, conductedAt?: string) {
  return apiFetch<{ report: MoveOutReport }>(inspectionReportPath("move-out", leaseId), {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conductedAt }),
  });
}

export type UpdateMoveOutDraftInput = UpdateInspectionDraftInput & {
  otherDeductionsAmount?: number;
  otherDeductionsNote?: string;
};

export function updateMoveOutReport(accessToken: string, leaseId: number, input: UpdateMoveOutDraftInput) {
  return apiFetch<{ report: MoveOutReport }>(inspectionReportPath("move-out", leaseId), {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function finalizeMoveOutReport(accessToken: string, leaseId: number, tenantSignature: Blob, agentSignature: Blob) {
  const fd = new FormData();
  fd.append("tenantSignature", tenantSignature, "signature-locataire.png");
  fd.append("agentSignature", agentSignature, "signature-agent.png");
  return apiFetch<{ report: MoveOutReport }>(`${inspectionReportPath("move-out", leaseId)}/finalize`, {
    method: "POST",
    accessToken,
    body: fd,
  });
}

/** Photo d'un élément (entrée ou sortie) — remplace la précédente le cas échéant. */
export function uploadInspectionItemPhoto(
  accessToken: string,
  kind: InspectionReportKind,
  leaseId: number,
  zoneKey: string,
  itemKey: string,
  photo: File,
) {
  const fd = new FormData();
  fd.append("photo", photo);
  return apiFetch<{ report: InspectionReport }>(
    `${inspectionReportPath(kind, leaseId)}/items/${zoneKey}/${itemKey}/photo`,
    { method: "POST", accessToken, body: fd },
  );
}

export function deleteInspectionItemPhoto(
  accessToken: string,
  kind: InspectionReportKind,
  leaseId: number,
  zoneKey: string,
  itemKey: string,
) {
  return apiFetch<{ report: InspectionReport }>(
    `${inspectionReportPath(kind, leaseId)}/items/${zoneKey}/${itemKey}/photo`,
    { method: "DELETE", accessToken },
  );
}

export function moveOutReportPdfPath(leaseId: number) {
  return `/api/leases/${leaseId}/move-out-report.pdf`;
}

/**
 * (Re)génère le lien du portail locataire (étape 12, idée n°2). Le token
 * n'est renvoyé qu'une seule fois ici, jamais stocké en clair côté serveur
 * (même principe que le mot de passe temporaire d'un employé) — régénérer
 * invalide l'ancien lien.
 */
export function generatePortalLink(accessToken: string, renterId: number) {
  return apiFetch<{ token: string; path: string }>(`/api/renters/${renterId}/portal-link`, {
    method: "POST",
    accessToken,
  });
}
