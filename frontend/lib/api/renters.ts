import { apiFetch, type Actor } from "./client";
import type { PropertyOwner, PropertyTypeKey, UnitDesignationKey } from "./properties";

export type PaymentMethod = "especes" | "mobile_money" | "virement" | "cheque";
export type InspectionCondition = "bon" | "moyen" | "mauvais";

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

export type MoveInReportItem = { label: string; condition: InspectionCondition; comment: string | null };
export type MoveInReport = {
  id: number;
  conductedAt: string;
  items: MoveInReportItem[];
  generalNotes: string | null;
  conductedBy: Actor;
};

/** Poste d'état des lieux de sortie : même grille que l'entrée, + retenue chiffrée. */
export type MoveOutReportItem = {
  label: string;
  condition: InspectionCondition;
  comment: string | null;
  deduction: number;
};
export type MoveOutReport = {
  id: number;
  conductedAt: string;
  items: MoveOutReportItem[];
  generalNotes: string | null;
  otherDeductionsAmount: number;
  otherDeductionsNote: string | null;
  depositAmount: number;
  totalDeductions: number;
  netRefund: number;
  conductedBy: Actor;
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

export function createMoveInReport(
  accessToken: string,
  leaseId: number,
  input: { conductedAt: string; items: MoveInReportItem[]; generalNotes?: string },
) {
  return apiFetch<{ reportId: number }>(`/api/leases/${leaseId}/move-in-report`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getMoveOutReport(accessToken: string, leaseId: number) {
  return apiFetch<{ report: MoveOutReport | null; arrears: Arrears | null }>(
    `/api/leases/${leaseId}/move-out-report`,
    { accessToken },
  );
}

export type CreateMoveOutReportInput = {
  conductedAt: string;
  items: MoveOutReportItem[];
  generalNotes?: string;
  otherDeductionsAmount?: number;
  otherDeductionsNote?: string;
};

export function createMoveOutReport(accessToken: string, leaseId: number, input: CreateMoveOutReportInput) {
  return apiFetch<{ reportId: number; totalDeductions: number; netRefund: number }>(
    `/api/leases/${leaseId}/move-out-report`,
    {
      method: "POST",
      accessToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
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
