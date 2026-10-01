import { apiFetch, API_URL, type Actor } from "./client";
import type { PropertyOwner, PropertyTypeKey, UnitDesignationKey } from "./properties";
import type { InspectionCondition } from "@/lib/constants/inspection";

export type PaymentMethod = "especes" | "mobile_money" | "virement" | "cheque" | "kkiapay";

/**
 * Convention de paiement du loyer (demande directe de l'utilisateur,
 * 2026-09-24) : 'avance' (défaut) = le loyer du mois M se paie dans le mois
 * M ; 'terme_echu' = seulement après, dans le mois M+1.
 */
export type RentTiming = "avance" | "terme_echu";
export const RENT_TIMING_LABELS: Record<RentTiming, string> = {
  avance: "Payé d'avance (dans le mois facturé)",
  terme_echu: "Payé à terme échu (après le mois facturé)",
};

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
  /** Déjà payé pour `nextDueMonth` (0 si rien) : un mois entamé se complète, il ne repart pas de zéro. */
  paidForNextDueMonth: number;
  dueDate: string;
  daysLate: number;
  monthsLate: number;
  remainderDaysLate: number;
  status: "current" | "late";
};

/** État d'un mois dans la frise des 12 mois d'un bail (calculé côté serveur, mois par mois). */
export type RentStripStatus = "paye" | "partiel" | "en_retard" | "a_payer" | "a_venir" | "avant_suivi" | "hors_bail";

export type RentStripMonth = {
  /** « AAAA-MM » */
  month: string;
  status: RentStripStatus;
  /** Cumul payé pour ce mois. */
  paid: number;
  /** Loyer dû pour ce mois. */
  due: number;
  remaining: number;
  /** Échéance de ce mois selon la convention du bail (« AAAA-MM-JJ »). */
  dueDate: string;
  /** Échéance dépassée alors que le mois n'est pas soldé. */
  late: boolean;
  isCurrent: boolean;
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
/**
 * Une ligne de facturation choisie sur un élément dégradé (état des lieux de
 * sortie) : soit une entrée du catalogue (`catalogItemId` renseigné, prix
 * copié depuis le référentiel), soit un élément non catalogué saisi à la
 * main (`catalogItemId: null`). `quantity` couvre plusieurs dégâts
 * identiques sur le même poste (ex. 2 vitres cassées).
 */
export type BillingLine = { catalogItemId: number | null; label: string; unitPrice: number; quantity: number };

export type InspectionItem = {
  key: string;
  label: string;
  custom: boolean;
  condition: InspectionCondition | null;
  comment: string | null;
  /** Jusqu'à 3 photos par élément (étape 48) — remplace l'ancien `photoUrl` (singulier). */
  photoUrls: string[];
  /** Recalculé côté serveur à partir de `billing.lines` dès qu'il y en a au moins une. */
  deduction: number;
  /** `null` = pas de facturation détaillée (montant libre dans `deduction`, saisie historique). */
  billing: { lines: BillingLine[] } | null;
};
export type InspectionZone = { key: string; label: string; custom: boolean; items: InspectionItem[] };
export type InspectionReportStatus = "draft" | "finalized";

export type InspectionReport = {
  id: number;
  status: InspectionReportStatus;
  conductedAt: string;
  zones: InspectionZone[];
  generalNotes: string | null;
  /** Notée par l'agent à l'oral au moment de la signature (étape 48) — jamais un accès en écriture du locataire. */
  tenantReserves: string | null;
  finalizedAt: string | null;
  tenantSignatureUrl: string | null;
  agentSignatureUrl: string | null;
  conductedBy: Actor;
  finalizedBy: Actor;
  /** Réouverture pour correction (étape 48, DG uniquement) — dernier événement seulement. */
  reopenedAt: string | null;
  reopenedBy: Actor;
  reopenReason: string | null;
};

export type MoveInReport = InspectionReport;

/** État des lieux de sortie : même fiche que l'entrée + décompte de caution. */
export type MoveOutReport = InspectionReport & {
  otherDeductionsAmount: number;
  otherDeductionsNote: string | null;
  /** Retenue sur la caution peinture (étape 43) — distincte de la caution de loyer ci-dessus. */
  peintureDeductionAmount: number;
  peintureDeductionNote: string | null;
  depositAmount: number;
  totalDeductions: number;
  netRefund: number;
  /** Bug corrigé (étape 48) : stocké et exigé depuis toujours, jamais renvoyé jusqu'ici. */
  refundPaymentMethod: Exclude<PaymentMethod, "kkiapay"> | null;
  glRegularizedAt: string | null;
  glRegularizedBy: Actor;
};

/** Règlement (total ou partiel) des impayés existants d'un bail à l'entrée. */
export type OpeningDebtPayment = {
  id: number;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  paidAt: string;
  notes: string | null;
  recordedBy: Actor;
};

/** Cautions supplémentaires (étape 43) — SBEE/SONEB (garantie contre les impayés de charges) et peinture. */
export type AdditionalDepositType = "sbee" | "soneb" | "peinture";
export type AdditionalDeposit = {
  type: AdditionalDepositType;
  typeLabel: string;
  amount: number;
  status: "held" | "returned";
  receivedAt: string | null;
  receivedMethod: PaymentMethod | null;
  returnedAt: string | null;
  returnedAmount: number | null;
  returnedMethod: PaymentMethod | null;
  deductionAmount: number;
  deductionNote: string | null;
};

export type Lease = {
  id: number;
  monthlyRent: number;
  depositAmount: number;
  depositStatus: "held" | "returned";
  /** Impayés déclarés à la création du bail (locataire déjà en place avant Lyko System), 0 si aucun. */
  openingDebtAmount: number;
  // Paid/remaining/payments : uniquement renvoyés par GET /api/renters/:id
  // (fiche détaillée) — absents de la liste (GET /api/renters), qui n'en a
  // pas besoin.
  openingDebtPaid?: number;
  openingDebtRemaining?: number;
  openingDebtPayments?: OpeningDebtPayment[];
  /** Déclaré à jour (aucun impayé) au moment de l'enregistrement — voir `computeArrears` (backend). */
  upToDateAtOnboarding: boolean;
  /** Frais d'agence pris directement au locataire à l'entrée — 100 % produit du cabinet, jamais compté dans la recette du propriétaire, 0 si aucun. */
  entryFeeAmount: number;
  entryFeeReceivedAt: string | null;
  entryFeeReceivedMethod: PaymentMethod | null;
  /** Prorata d'entrée (étape 42) — appartient au propriétaire (compte séquestre), distinct des frais d'agence ci-dessus (100 % cabinet). */
  entryProration: "aucun" | "prorata";
  entryProrataAmount: number;
  entryProrataDays: number | null;
  entryProrataDueDate: string | null;
  entryProrataReceivedAt: string | null;
  entryProrataReceivedMethod: PaymentMethod | null;
  /** Cautions supplémentaires (étape 43) — uniquement les types activés par l'entreprise et effectivement demandés à ce bail. */
  additionalDeposits: AdditionalDeposit[];
  rentDueDay: number;
  rentTiming: RentTiming;
  startDate: string;
  endDate: string | null;
  status: "active" | "ended";
  unit: LeaseUnit;
  payments: Payment[];
  arrears: Arrears | null;
  /** Frise des 12 mois : uniquement renvoyée par GET /api/renters/:id (bail actif) — la liste la porte au niveau de l'élément. */
  rentStrip?: RentStripMonth[] | null;
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
  notesUpdatedBy: Actor;
  notesUpdatedAt: string | null;
  createdBy: Actor;
  createdAt: string;
  /** Un lien de portail a déjà été généré pour ce locataire (jamais le token lui-même). */
  hasPortalLink: boolean;
  portalLinkCreatedAt: string | null;
};

export type RenterListItem = Renter & { activeLease: Lease | null; arrears: Arrears | null; rentStrip: RentStripMonth[] | null };

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
  // Requis côté serveur seulement si depositAmount > 0 (voir routes/renters.js
  // `recordDepositReceived`) — génère la contrepartie comptable de la caution.
  depositPaymentMethod?: Exclude<PaymentMethod, "kkiapay">;
  // Défaut : startDate si omis (la caution est presque toujours encaissée le
  // jour de la signature du bail).
  depositPaidAt?: string;
  /** Frais d'agence pris directement au locataire à l'entrée — 100 % produit du cabinet, jamais reversé au propriétaire. */
  entryFeeAmount?: number;
  // Requis côté serveur seulement si entryFeeAmount > 0 (voir routes/renters.js
  // `recordEntryFeeReceived`) — génère la contrepartie comptable (706).
  entryFeePaymentMethod?: Exclude<PaymentMethod, "kkiapay">;
  entryFeePaidAt?: string;
  /**
   * Prorata d'entrée (étape 42) : 'aucun' (rien facturé, comportement historique) ou 'prorata' (jours
   * occupés avant la première échéance normale, appartient au propriétaire). Optionnel — si omis, le
   * serveur retombe sur le réglage par défaut de l'entreprise. Le MONTANT n'est jamais envoyé ici : il
   * est toujours recalculé par le serveur à partir de `startDate`/`monthlyRent`/`rentDueDay`.
   */
  entryProration?: "aucun" | "prorata";
  // Requis côté serveur seulement si le prorata calculé est > 0 (voir routes/renters.js `recordEntryProrataReceived`).
  entryProrataPaymentMethod?: Exclude<PaymentMethod, "kkiapay">;
  entryProrataPaidAt?: string;
  rentDueDay: number;
  /** Optionnel — si omis, le serveur retombe sur le réglage par défaut de l'entreprise (Paramètres). */
  rentTiming?: RentTiming;
  startDate: string;
  /** Onboarding d'un locataire déjà en place : impayés déjà dus avant Lyko System, 0 si aucun. */
  openingDebtAmount?: number;
  /** Onboarding : locataire déjà en place mais SANS aucun impayé — évite un faux retard depuis une date d'entrée ancienne. */
  upToDateAtOnboarding?: boolean;
  /**
   * Cautions supplémentaires (étape 43) — un type non activé par l'entreprise envoyé quand même est
   * simplement ignoré côté serveur. Mode de règlement requis seulement si le montant est > 0.
   */
  additionalDeposits?: Partial<
    Record<AdditionalDepositType, { amount: number; paymentMethod?: Exclude<PaymentMethod, "kkiapay">; paidAt?: string }>
  >;
};

export function createRenter(accessToken: string, input: CreateRenterInput) {
  // Le lien du portail locataire est généré automatiquement à la création
  // (étape 13, idée n°2) — renvoyé une seule fois ici, comme un mot de passe
  // temporaire ; il faudra passer par `generatePortalLink` (régénérer) pour
  // en obtenir un nouveau si celui-ci est perdu.
  return apiFetch<{
    renterId: number;
    leaseId: number;
    unitId: number;
    entryProrata: { proration: "aucun" | "prorata"; amount: number; days: number; dueDate: string };
    additionalDeposits: AdditionalDeposit[];
    portalLink: { token: string; path: string };
  }>(
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
}>;

export function updateRenter(accessToken: string, id: number, input: UpdateRenterInput) {
  return apiFetch<{ renter: Renter }>(`/api/renters/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * Note interne libre sur la situation du locataire — endpoint séparé de `updateRenter`
 * (identité) et volontairement ouvert à tout employé authentifié (comptable, agent),
 * pas seulement à qui a le droit de modifier la fiche (demande explicite de l'utilisateur).
 */
export function updateRenterNotes(accessToken: string, id: number, notes: string | null) {
  return apiFetch<{ renter: Renter }>(`/api/renters/${id}/notes`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
}

export type CreateLeaseInput = Omit<
  CreateRenterInput,
  "firstName" | "lastName" | "phone" | "email" | "profession" | "notes"
>;

export function createLease(accessToken: string, renterId: number, input: CreateLeaseInput) {
  return apiFetch<{
    leaseId: number;
    unitId: number;
    entryProrata: { proration: "aucun" | "prorata"; amount: number; days: number; dueDate: string };
    additionalDeposits: AdditionalDeposit[];
  }>(`/api/renters/${renterId}/leases`, {
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
  /** Clé d'idempotence de CET envoi (voir `newIdempotencyKey`) : un rejeu avec la même clé n'enregistre rien de plus. */
  idempotencyKey?: string;
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
      // La MÊME clé suit le paiement dans la file : si la réponse s'était perdue alors que le serveur
      // l'avait enregistré, le rejeu ne le double pas.
      if (input.idempotencyKey) body.idempotencyKey = input.idempotencyKey;
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

export type LateFee = {
  id: number;
  amount: number;
  appliedAt: string;
  reason: string | null;
  appliedBy: Actor;
  createdAt: string;
  /** Suivi de règlement (étape 44bis) — une pénalité peut être réglée totalement ou partiellement. */
  paid: number;
  remaining: number;
  status: "impayee" | "partielle" | "payee";
};

export function listLateFees(accessToken: string, leaseId: number) {
  return apiFetch<{ lateFees: LateFee[] }>(`/api/leases/${leaseId}/late-fees`, { accessToken });
}

/** Montant toujours saisi à la main — jamais un barème automatique. */
export function applyLateFee(
  accessToken: string,
  leaseId: number,
  input: { amount: number; appliedAt: string; reason?: string; idempotencyKey?: string },
) {
  return apiFetch<{ lateFeeId: number }>(`/api/leases/${leaseId}/late-fees`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Règle (total ou partiel) une pénalité de retard déjà appliquée (étape 44bis). */
export function payLateFee(
  accessToken: string,
  leaseId: number,
  lateFeeId: number,
  input: { amount: number; paymentMethod: PaymentMethod; paidAt: string; notes?: string; idempotencyKey?: string },
) {
  return apiFetch<{ paymentId: number; remaining: number }>(`/api/leases/${leaseId}/late-fees/${lateFeeId}/payments`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Règle (total ou partiel) les impayés existants d'un bail — voir `Lease.openingDebtRemaining`. */
export function payOpeningDebt(
  accessToken: string,
  leaseId: number,
  input: { amount: number; paymentMethod: PaymentMethod; paidAt: string; notes?: string; idempotencyKey?: string },
) {
  return apiFetch<{ paymentId: number; remaining: number }>(`/api/leases/${leaseId}/opening-debt/payments`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Historique des soldes figés à chaque clôture de mois (audit) pour un bail. */
export type LeaseBalanceSnapshot = { period: string; amountDue: number; createdAt: string };

export function getLeaseBalanceSnapshots(accessToken: string, leaseId: number) {
  return apiFetch<{ snapshots: LeaseBalanceSnapshot[] }>(`/api/leases/${leaseId}/balance-snapshots`, { accessToken });
}


/**
 * Lien de partage direct de cette quittance (envoi automatique par WhatsApp
 * juste après le paiement — un lien `wa.me` ne peut préremplir qu'un texte,
 * jamais joindre un fichier). Idempotent côté serveur : rappeler cette
 * fonction pour la même quittance renvoie toujours le même token.
 */
export function generateReceiptShareLink(accessToken: string, leaseId: number, paymentId: number) {
  return apiFetch<{ token: string }>(`/api/leases/${leaseId}/payments/${paymentId}/receipt-link`, {
    method: "POST",
    accessToken,
  });
}

/** URL publique (sans auth) qui sert directement le PDF — voir `generateReceiptShareLink`. */
export function receiptShareUrl(token: string) {
  return `${API_URL}/api/recu/${token}`;
}

// Contrat de bail (étape 46) — remplace l'ancienne attestation de loyer. Document structuré par
// articles, calculés depuis les données du bail (jamais saisis à la main, seules les conditions
// particulières le sont), signé par les deux parties. Même cycle brouillon → finalisation que les
// états des lieux.
export type AdditionalDepositSummary = { type: AdditionalDepositType; typeLabel: string; amount: number };
export type LeaseContractData = {
  renter: { firstName: string; lastName: string; phone: string };
  owner: { name: string; phone: string; address: string | null };
  property: { code: string; address: string | null; typeLabel: string };
  unit: { code: string; designationLabel: string; furnished: boolean; sonebMeterNumber: string | null; sbeeMeterNumber: string | null };
  lease: {
    startDate: string;
    monthlyRent: number;
    rentDueDay: number;
    rentTiming: RentTiming;
    rentTimingLabel: string;
    depositAmount: number;
    entryFeeAmount: number;
  };
  additionalDeposits: AdditionalDepositSummary[];
  particularConditions: string | null;
};
export type LeaseContract = {
  id: number;
  status: "draft" | "finalized";
  particularConditions: string | null;
  tenantSignatureUrl: string | null;
  agentSignatureUrl: string | null;
  finalizedAt: string | null;
  finalizedBy: Actor | null;
  createdBy: Actor;
  createdAt: string;
};

export function getContract(accessToken: string, leaseId: number) {
  return apiFetch<{ contract: LeaseContract | null; preview: LeaseContractData }>(`/api/leases/${leaseId}/contract`, {
    accessToken,
  });
}

export function startContract(accessToken: string, leaseId: number) {
  return apiFetch<{ contract: LeaseContract; preview: LeaseContractData }>(`/api/leases/${leaseId}/contract`, {
    method: "POST",
    accessToken,
  });
}

export function updateContract(accessToken: string, leaseId: number, particularConditions: string) {
  return apiFetch<{ contract: LeaseContract; preview: LeaseContractData }>(`/api/leases/${leaseId}/contract`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ particularConditions }),
  });
}

export function finalizeContract(accessToken: string, leaseId: number, tenantSignature: Blob, agentSignature: Blob) {
  const fd = new FormData();
  fd.append("tenantSignature", tenantSignature, "signature-locataire.png");
  fd.append("agentSignature", agentSignature, "signature-agent.png");
  return apiFetch<{ contract: LeaseContract; preview: LeaseContractData }>(`/api/leases/${leaseId}/contract/finalize`, {
    method: "POST",
    accessToken,
    body: fd,
  });
}

export function contractPdfPath(leaseId: number) {
  return `/api/leases/${leaseId}/contract.pdf`;
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

export function finalizeMoveInReport(
  accessToken: string,
  leaseId: number,
  tenantSignature: Blob,
  agentSignature: Blob,
  tenantReserves?: string,
) {
  const fd = new FormData();
  fd.append("tenantSignature", tenantSignature, "signature-locataire.png");
  fd.append("agentSignature", agentSignature, "signature-agent.png");
  if (tenantReserves) fd.append("tenantReserves", tenantReserves);
  return apiFetch<{ report: MoveInReport }>(`${inspectionReportPath("move-in", leaseId)}/finalize`, {
    method: "POST",
    accessToken,
    body: fd,
  });
}

/**
 * Réouverture d'une fiche finalisée (étape 48, DG uniquement) — motif
 * obligatoire, tracé au journal d'activité. Invalide les deux signatures
 * existantes : il faudra resigner avant de refinaliser.
 */
export function reopenMoveInReport(accessToken: string, leaseId: number, reason: string) {
  return apiFetch<{ report: MoveInReport }>(`${inspectionReportPath("move-in", leaseId)}/reopen`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export function moveInReportPdfPath(leaseId: number) {
  return `/api/leases/${leaseId}/move-in-report.pdf`;
}

export function getMoveOutReport(accessToken: string, leaseId: number) {
  return apiFetch<{ report: MoveOutReport | null; arrears: Arrears | null; additionalDeposits: AdditionalDeposit[] }>(
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
  /** Retenue sur la caution peinture (étape 43) — plafonnée à SA PROPRE caution, jamais mêlée à `otherDeductionsAmount`. */
  peintureDeductionAmount?: number;
  peintureDeductionNote?: string;
};

export function updateMoveOutReport(accessToken: string, leaseId: number, input: UpdateMoveOutDraftInput) {
  return apiFetch<{ report: MoveOutReport; additionalDeposits: AdditionalDeposit[] }>(
    inspectionReportPath("move-out", leaseId),
    {
      method: "PATCH",
      accessToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

/**
 * `refundPaymentMethod` : requis côté serveur seulement s'il reste
 * effectivement quelque chose à reverser (`netRefund > 0`) — génère la
 * contrepartie comptable de la restitution (voir routes/leases.js).
 * `additionalDepositRefundMethods` : un mode par caution supplémentaire encore détenue (étape 43),
 * requis côté serveur seulement pour celles dont il reste effectivement une part à rendre.
 */
export function finalizeMoveOutReport(
  accessToken: string,
  leaseId: number,
  tenantSignature: Blob,
  agentSignature: Blob,
  refundPaymentMethod?: Exclude<PaymentMethod, "kkiapay">,
  additionalDepositRefundMethods?: Partial<Record<AdditionalDepositType, Exclude<PaymentMethod, "kkiapay">>>,
  tenantReserves?: string,
) {
  const fd = new FormData();
  fd.append("tenantSignature", tenantSignature, "signature-locataire.png");
  fd.append("agentSignature", agentSignature, "signature-agent.png");
  if (refundPaymentMethod) fd.append("refundPaymentMethod", refundPaymentMethod);
  if (additionalDepositRefundMethods?.sbee) fd.append("refundMethodSbee", additionalDepositRefundMethods.sbee);
  if (additionalDepositRefundMethods?.soneb) fd.append("refundMethodSoneb", additionalDepositRefundMethods.soneb);
  if (additionalDepositRefundMethods?.peinture) fd.append("refundMethodPeinture", additionalDepositRefundMethods.peinture);
  if (tenantReserves) fd.append("tenantReserves", tenantReserves);
  return apiFetch<{ report: MoveOutReport; depositAccountingNote: string | null; additionalDeposits: AdditionalDeposit[] }>(
    `${inspectionReportPath("move-out", leaseId)}/finalize`,
    {
      method: "POST",
      accessToken,
      body: fd,
    },
  );
}

/** Réouverture (étape 48) — voir `reopenMoveInReport` ci-dessus, même principe, mais ne défait
 * jamais les effets déjà survenus (bail terminé, unité libérée, cautions réglées) — seul le
 * contenu de la fiche redevient modifiable (voir routes/leases.js). */
export function reopenMoveOutReport(accessToken: string, leaseId: number, reason: string) {
  return apiFetch<{ report: MoveOutReport; additionalDeposits: AdditionalDeposit[] }>(
    `${inspectionReportPath("move-out", leaseId)}/reopen`,
    { method: "POST", accessToken, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) },
  );
}

/** Marque comme réglée (à la main, en comptabilité) une restitution de caution avec retenue. */
export function markMoveOutGlRegularized(accessToken: string, leaseId: number) {
  return apiFetch<{ report: MoveOutReport }>(`${inspectionReportPath("move-out", leaseId)}/gl-regularized`, {
    method: "POST",
    accessToken,
  });
}

/** Photo d'un élément (entrée ou sortie) — jusqu'à 3 par élément (étape 48), s'ajoute aux existantes. */
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

/** `photoIndex` : position dans `item.photoUrls` (0 à 2) — plus de photo unique implicite. */
export function deleteInspectionItemPhoto(
  accessToken: string,
  kind: InspectionReportKind,
  leaseId: number,
  zoneKey: string,
  itemKey: string,
  photoIndex: number,
) {
  return apiFetch<{ report: InspectionReport }>(
    `${inspectionReportPath(kind, leaseId)}/items/${zoneKey}/${itemKey}/photo/${photoIndex}`,
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
