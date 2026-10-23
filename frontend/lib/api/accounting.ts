import { apiFetch, type Actor } from "./client";
import type { PaymentMethod } from "./renters";
import type { ChargeStatus } from "./charges";

export type ExpenseCategory =
  | "loyer_bureau"
  | "salaires"
  | "fournitures"
  | "entretien"
  | "transport"
  | "communication"
  | "marketing"
  | "taxes"
  | "autre";

export type Expense = {
  id: number;
  category: ExpenseCategory;
  label: string;
  amount: number;
  expenseDate: string;
  paymentStatus: "paid" | "unpaid";
  // `null` uniquement pour une dépense "à crédit" pas encore réglée.
  paymentMethod: PaymentMethod | null;
  paymentMethodLabel: string | null;
  paidAt: string | null;
  supplierId: number | null;
  supplierName: string | null;
  notes: string | null;
  receiptUrl: string | null;
  // Facultatif : dépense rattachée à un Bien (et une Unité précise en son
  // sein) pour la recette/commission — null pour une dépense de
  // fonctionnement du cabinet (comportement historique).
  propertyId: number | null;
  unitId: number | null;
  // Code du Bien (ex. "BIEN-004") quand `propertyId` est défini — permet
  // d'afficher un badge distinguant, dans le journal commun, un travaux
  // facturé à un propriétaire d'une dépense de fonctionnement du cabinet.
  propertyCode: string | null;
  recordedBy: Actor;
  createdAt: string;
};

export type FixedAssetCategory = "informatique" | "mobilier" | "transport";

export function getAccountingMeta(accessToken: string) {
  return apiFetch<{
    categories: { key: ExpenseCategory; label: string }[];
    paymentMethods: PaymentMethod[];
    fixedAssetCategories: { key: FixedAssetCategory; label: string }[];
  }>("/api/accounting/meta", { accessToken });
}

export function listExpenses(
  accessToken: string,
  filters?: { from?: string; to?: string; category?: ExpenseCategory; q?: string },
) {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.q) params.set("q", filters.q);
  const qs = params.toString();
  return apiFetch<{ expenses: Expense[] }>(`/api/accounting/expenses${qs ? `?${qs}` : ""}`, { accessToken });
}

export type CreateExpenseInput = {
  category: ExpenseCategory;
  label: string;
  amount: number;
  expenseDate: string;
  /** "paid" (défaut) : réglée immédiatement, comme avant — requiert `paymentMethod`. "unpaid" : à crédit — requiert `supplierName`, jamais `paymentMethod`. */
  paymentStatus?: "paid" | "unpaid";
  paymentMethod?: PaymentMethod;
  /** Créé à la volée si nouveau (recherché par nom exact pour cette entreprise). */
  supplierName?: string;
  notes?: string;
  receipt?: File;
  /** Rattache la dépense à un Bien (réduit sa recette nette) ; `unitId` doit appartenir à ce Bien. */
  propertyId?: number;
  unitId?: number;
  /** Clé d'idempotence de CET envoi (voir `useIdempotencyKey`). */
  idempotencyKey?: string;
};

export function createExpense(accessToken: string, input: CreateExpenseInput) {
  const { receipt, ...rest } = input;
  const fd = new FormData();
  fd.append("category", rest.category);
  fd.append("label", rest.label);
  fd.append("amount", String(rest.amount));
  fd.append("expenseDate", rest.expenseDate);
  fd.append("paymentStatus", rest.paymentStatus ?? "paid");
  if (rest.paymentMethod) fd.append("paymentMethod", rest.paymentMethod);
  if (rest.supplierName) fd.append("supplierName", rest.supplierName);
  if (rest.notes) fd.append("notes", rest.notes);
  if (rest.propertyId) fd.append("propertyId", String(rest.propertyId));
  if (rest.unitId) fd.append("unitId", String(rest.unitId));
  if (rest.idempotencyKey) fd.append("idempotencyKey", rest.idempotencyKey);
  if (receipt) fd.append("receipt", receipt);
  return apiFetch<{ expenseId: number }>("/api/accounting/expenses", {
    method: "POST",
    accessToken,
    body: fd,
  });
}

/** Solde une dépense "à crédit" — génère le règlement comptable (voir routes/accounting.js). */
export function paySupplierExpense(accessToken: string, expenseId: number, input: { paymentMethod: PaymentMethod; paidAt: string }) {
  return apiFetch<void>(`/api/accounting/expenses/${expenseId}/pay`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type Supplier = { id: number; name: string; totalOwed: number };

export function listSuppliers(accessToken: string) {
  return apiFetch<{ suppliers: Supplier[] }>("/api/accounting/suppliers", { accessToken });
}

export type UpdateExpenseInput = Partial<Omit<CreateExpenseInput, "receipt">>;

export function updateExpense(accessToken: string, id: number, input: UpdateExpenseInput) {
  return apiFetch<{ expense: Expense }>(`/api/accounting/expenses/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteExpense(accessToken: string, id: number, reason: string) {
  return apiFetch<void>(`/api/accounting/expenses/${id}`, {
    method: "DELETE",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export type UtilityType = "soneb" | "sbee";

export type TenantArrearsEntry = {
  leaseId: number;
  renterName: string;
  daysLate: number;
  unpaidMonths: number;
  /** Reliquat d'impayés à l'entrée (onboarding) — distinct du retard de loyer, voir `unpaidMonths`. */
  openingDebtRemaining: number;
  /** Pénalités de retard appliquées mais non réglées (étape 44bis) — distinct du loyer, voir `unpaidMonths`. */
  lateFeesRemaining: number;
  amountOwed: number;
};

// Clôturabilité d'un mois non encore clôturé : l'échéance de loyer la plus
// tardive parmi les baux actifs de ce mois (propre à chaque locataire, ne
// sert qu'à son propre retard) détermine, avec une marge de sécurité, à
// partir de quand la clôture est sûre. `pendingLeases` liste les locataires
// dont l'échéance de ce mois précis n'est pas encore passée.
export type PeriodClosability = {
  status: "open" | "closable";
  closableFrom: string;
  maxDueDay: number | null;
  pendingLeases: { leaseId: number; renterName: string; unitCode: string; dueDay: number }[];
};

export type AccountingDashboard = {
  period: { from: string; to: string };
  isClosed: boolean;
  closedInfo: { closedAt: string; closedBy: Actor; forced: boolean } | null;
  closability: PeriodClosability | null;
  totals: {
    rentCollected: number;
    rentCollectedCount: number;
    ownerPayouts: number;
    ownerPayoutsCount: number;
    expenses: number;
    expensesCount: number;
    // Informatif : travaux facturés à un Bien sur la période — déjà EXCLUS
    // de `expenses`/`netCashFlow` ci-dessus, à la charge du propriétaire
    // concerné (déduits de sa recette, jamais de celle du cabinet).
    propertyExpenses: number;
    propertyExpensesCount: number;
    unpaidCharges: number;
    unpaidChargesCount: number;
    tenantArrears: number;
    tenantArrearsCount: number;
    // Frais d'agence pris directement au locataire à l'entrée — 100 % produit
    // du cabinet, jamais compté dans la recette du propriétaire (à part de
    // `rentCollected`, qui lui se répartit encore entre commission et
    // propriétaire) ; déjà inclus dans `netCashFlow`.
    entryFeesCollected: number;
    entryFeesCollectedCount: number;
    // Commission sur vente d'un bien à vendre (bouton « Vendu ») — même principe que
    // `entryFeesCollected` : 100 % produit du cabinet, déjà inclus dans `netCashFlow`.
    saleCommissionsCollected: number;
    saleCommissionsCollectedCount: number;
    /** Autres entrées du cabinet (honoraires, intérêts, remboursements…) — 100 % produit de l'entreprise. */
    otherIncomes: number;
    otherIncomesCount: number;
    netCashFlow: number;
    /** Trésorerie réelle du mois (toutes entrées − toutes sorties) ; `null` hors mois calendaire unique. */
    treasuryNet: number | null;
    treasuryIn: number | null;
    treasuryOut: number | null;
  };
  expensesByCategory: { category: ExpenseCategory; total: number }[];
  unpaidChargesByType: { utilityType: UtilityType; total: number; count: number }[];
  tenantArrears: TenantArrearsEntry[];
  /**
   * Comptes séquestres par mandat : combien le cabinet détient ACTUELLEMENT
   * pour chaque propriétaire (cumulé depuis toujours, pas borné à
   * `period.from/to` comme `totals` ci-dessus).
   */
  escrow: { total: number; openingDebtUnpaidTotal: number; byOwner: EscrowByOwnerEntry[] };
  /**
   * Garde-fou (cas réel trouvé 2026-09-22) : propriétaires avec des loyers
   * déjà encaissés mais AUCUN taux de commission jamais défini — 0 %
   * appliqué en silence sinon. Jamais borné à la période affichée.
   */
  ownersWithoutCommissionRate: { ownerId: number; ownerName: string; totalCollected: number }[];
  /**
   * Recette nette du CABINET lui-même (étape 44) — commission sur tous les propriétaires + frais
   * d'agence, moins les dépenses de fonctionnement (jamais celles facturées à un Bien). Toujours par
   * mois calendaire : `null` si `period.from`/`period.to` ne correspondent pas au même mois.
   */
  cabinetRevenue: {
    yearMonth: string;
    breakdown: { commission: number; entryFees: number; lateFees: number; saleCommissions: number; otherIncomes?: number; expenses: number };
    netCabinetIncome: number;
  } | null;
};

export type EscrowByOwnerEntry = {
  ownerId: number;
  ownerName: string;
  totalCollected: number;
  totalPayouts: number;
  balance: number;
  /** Impayés de locataire(s) à l'entrée, non réglés, pour ce propriétaire — montant brut, jamais mélangé à `balance`. */
  openingDebtUnpaid: number;
  /** Détail de `totalCollected` (étape 42) — voir sa fiche pour l'affichage complet. */
  breakdown: { rent: number; openingDebt: number; prorata: number; expenses: number };
};

export function getDashboard(accessToken: string, from: string, to: string) {
  return apiFetch<AccountingDashboard>(
    `/api/accounting/dashboard?from=${from}&to=${to}`,
    { accessToken },
  );
}

/** Rapport mensuel exportable (étape 18) — même période que le tableau de bord écran. */
export function accountingReportPdfPath(from: string, to: string) {
  return `/api/accounting/dashboard.pdf?from=${from}&to=${to}`;
}

/** Registre comptable détaillé exportable en Excel (étape 27) — même période que le tableau de bord écran. */
export function accountingExportXlsxPath(from: string, to: string) {
  return `/api/accounting/export.xlsx?from=${from}&to=${to}`;
}

/** Loyers d'un mois de loyer, tous baux suivis confondus (encadré « Ce mois-ci » de Comptabilité). */
export type RentMonthSummary = {
  month: string;
  isCurrentMonth: boolean;
  expected: number;
  collected: number;
  remaining: number;
  /** Part du reste dont l'échéance est déjà passée. */
  lateRemaining: number;
  /** Part du reste pas encore due. */
  upcomingRemaining: number;
  counts: { leases: number; paye: number; partiel: number; en_retard: number; a_payer: number; a_venir: number; late: number };
};

export function getRentMonthSummary(accessToken: string, month: string) {
  return apiFetch<RentMonthSummary>(`/api/accounting/rent-month?month=${encodeURIComponent(month)}`, { accessToken });
}

/**
 * Point financier d'UN locataire pour un mois (étape clôture, demande utilisateur 2026-10-18) — une
 * ligne par bail suivi ce mois-là, triée du plus préoccupant (en retard) au moins préoccupant (payé).
 */
export type RentMonthRenter = {
  leaseId: number;
  renterId: number;
  renterName: string;
  unitLabel: string;
  propertyLabel: string;
  monthlyRent: number;
  paid: number;
  remaining: number;
  status: "paye" | "partiel" | "en_retard" | "a_payer" | "a_venir";
  late: boolean;
};

export function getRentMonthRenters(accessToken: string, month: string) {
  return apiFetch<{ month: string; renters: RentMonthRenter[] }>(
    `/api/accounting/rent-month/${encodeURIComponent(month)}/renters`,
    { accessToken },
  );
}

// Le bilan complet d'un mois (recettes/dépenses/charges + statut des propriétaires reversés/non)
// est désormais `getMonthBilan` (voir plus bas) — implémentation plus complète construite en
// parallèle qui a remplacé celle-ci.

export type RentPaymentEntry = {
  id: number;
  renter: { id: number; firstName: string; lastName: string };
  unitCode: string;
  coversMonth: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  paidAt: string;
  recordedBy: Actor;
};

export function listRentPayments(accessToken: string, from: string, to: string) {
  return apiFetch<{ payments: RentPaymentEntry[] }>(
    `/api/accounting/rent-payments?from=${from}&to=${to}`,
    { accessToken },
  );
}

export type OwnerPayoutEntry = {
  id: number;
  owner: { id: number; name: string };
  periodLabel: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  paidAt: string;
  recordedBy: Actor;
};

export function listOwnerPayouts(accessToken: string, from: string, to: string) {
  return apiFetch<{ payouts: OwnerPayoutEntry[] }>(
    `/api/accounting/owner-payouts?from=${from}&to=${to}`,
    { accessToken },
  );
}

// Vue d'ensemble de la clôture (étape 54) : prochain mois à clôturer, frise des mois, vérifications.
export type ClosingMonthStatus = "cloture" | "pret" | "en_attente" | "en_cours" | "a_suivre" | "hors_suivi";
export type ClosingCheck =
  | {
      key: "echeances";
      status: "ok" | "bloquant";
      closableFrom: string;
      pendingLeases: { leaseId: number; renterName: string; unitCode: string; dueDay: number }[];
    }
  | {
      key: "loyers";
      status: "ok" | "attention";
      expected: number;
      collected: number;
      remaining: number;
      lateRemaining: number;
      unpaidLeases: number;
    }
  | {
      key: "releves";
      status: "ok" | "attention";
      batches: { id: number; utilityType: string; periodStart: string; periodEnd: string; propertyCode: string }[];
    }
  | { key: "justificatifs"; status: "ok" | "attention"; count: number; total: number };

export type ClosingOverview = {
  currentMonth: string;
  /** Prochain mois à clôturer (« AAAA-MM ») ; `null` si rien n'a encore été enregistré. */
  nextMonth: string | null;
  accountingStartDate: string | null;
  months: { month: string; status: ClosingMonthStatus; forced: boolean; closableFrom: string | null }[];
  /** Détail du prochain mois s'il n'est pas dans le futur. */
  next: {
    month: string;
    isCurrentMonth: boolean;
    isClosable: boolean;
    closableFrom: string;
    checks: ClosingCheck[];
  } | null;
};

export function getClosingOverview(accessToken: string) {
  return apiFetch<ClosingOverview>("/api/accounting/closing-overview", { accessToken });
}

export type AccountingPeriod = {
  /** « AAAA-MM » pour une période calendaire, `null` pour un rythme « jour fixe »/« libre ». */
  period: string | null;
  periodStart: string;
  periodEnd: string;
  closedAt: string;
  closedBy: Actor;
  forced: boolean;
};

export function listClosedPeriods(accessToken: string) {
  return apiFetch<{ periods: AccountingPeriod[] }>("/api/accounting/periods", { accessToken });
}

/**
 * Clôture : `period` (« AAAA-MM ») en rythme calendaire ; sinon le serveur déduit lui-même le début
 * de la période ouverte et `periodEnd` fixe sa fin (obligatoire en rythme « libre », proposée par le
 * serveur en « jour fixe » si omise).
 */
export function closePeriod(accessToken: string, input: { period?: string; periodEnd?: string }, force?: boolean) {
  return apiFetch<{ period: string | null; periodStart: string; periodEnd: string; forced: boolean }>("/api/accounting/periods", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, force: force ?? false }),
  });
}

// Date de démarrage de la comptabilité — bornée par le DG, modifiable à tout
// moment (contrairement à une clôture). Avant cette date, aucune écriture ne
// peut être créée ; la consultation des périodes anciennes reste toujours
// possible, quelle que soit cette date.
export type AccountingStartDate = { startDate: string | null; setAt: string | null; setBy: Actor };

export function getAccountingStartDate(accessToken: string) {
  return apiFetch<AccountingStartDate>("/api/accounting/start-date", { accessToken });
}

export function setAccountingStartDate(accessToken: string, startDate: string | null) {
  return apiFetch<{ startDate: string | null }>("/api/accounting/start-date", {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startDate }),
  });
}

// Rythme de période (étape 2b/5, 2026-10-16) : 'calendaire' (par défaut, zéro changement visible),
// 'jour_fixe' (jour de départ 1-28) ou 'libre' (date de fin saisie à chaque clôture). Change
// uniquement les PROCHAINES clôtures — aucune période déjà clôturée ne bouge jamais.
export type PeriodRhythmMode = "calendaire" | "jour_fixe" | "libre";
export type TenantRhythm = { mode: PeriodRhythmMode; startDay: number | null };

export function getTenantRhythm(accessToken: string) {
  return apiFetch<TenantRhythm>("/api/accounting/rhythm", { accessToken });
}


// Journal des suppressions (DG uniquement) : dépenses et charges SONEB/SBEE
// supprimées logiquement — trace, auteur, justification, jamais dans les totaux.
export type DeletedEntry = {
  type: "expense" | "charge";
  id: number;
  label: string;
  amount: number;
  date: string;
  createdBy: Actor;
  deletedBy: Actor;
  deletedAt: string;
  reason: string;
};

export function listDeletedEntries(accessToken: string) {
  return apiFetch<{ entries: DeletedEntry[] }>("/api/accounting/deleted-entries", { accessToken });
}

// Centre de relance groupée (étape 10) : tous les locataires en retard sur
// le portefeuille, avec de quoi construire un lien WhatsApp de relance.
export type PortfolioArrearsEntry = {
  leaseId: number;
  renterId: number;
  renterName: string;
  phone: string;
  unitCode: string;
  propertyCode: string;
  monthlyRent: number;
  dueDate: string;
  daysLate: number;
  unpaidMonths: number;
  /** Reliquat d'impayés à l'entrée (onboarding) — distinct du retard de loyer, voir `unpaidMonths`. */
  openingDebtRemaining: number;
  /** Pénalités de retard appliquées mais non réglées (étape 44bis) — distinct du loyer, voir `unpaidMonths`. */
  lateFeesRemaining: number;
  amountOwed: number;
};

export function listPortfolioArrears(accessToken: string) {
  return apiFetch<{ arrears: PortfolioArrearsEntry[]; total: number }>("/api/accounting/arrears", { accessToken });
}

// Alertes prédictives de retard (étape 13, idée n°4) : locataires à jour,
// échéance proche, mais historiquement en retard — pour relancer avant que
// le retard n'arrive.
export type PredictiveAlertEntry = {
  leaseId: number;
  renterId: number;
  renterName: string;
  phone: string;
  unitCode: string;
  propertyCode: string;
  monthlyRent: number;
  dueDate: string;
  daysUntilDue: number;
  lateCount: number;
  recentPaymentsCount: number;
};

export function listPredictiveAlerts(accessToken: string) {
  return apiFetch<{ alerts: PredictiveAlertEntry[] }>("/api/accounting/predictive-alerts", { accessToken });
}

// Charges SONEB/SBEE impayées ou partiellement payées (étape 28) — une ligne
// par facture, pas par locataire (voir commentaire côté serveur).
export type UtilityArrearsEntry = {
  chargeId: number;
  leaseId: number;
  renterId: number;
  renterName: string;
  phone: string;
  unitCode: string;
  propertyCode: string;
  utilityType: UtilityType;
  status: ChargeStatus;
  billedAt: string;
  daysLate: number;
  amountOwed: number;
};

export function listUtilityArrears(accessToken: string) {
  return apiFetch<{ arrears: UtilityArrearsEntry[]; total: number }>("/api/accounting/utility-arrears", { accessToken });
}

// Immobilisations du cabinet (matériel propre à l'agence — jamais les Biens
// gérés pour le compte des propriétaires). Même schéma "à crédit" que les
// dépenses ; la valeur nette comptable reflète uniquement les mois
// d'amortissement RÉELLEMENT saisis, jamais une estimation théorique.
export type FixedAsset = {
  id: number;
  label: string;
  category: FixedAssetCategory;
  acquisitionDate: string;
  acquisitionCost: number;
  usefulLifeYears: number;
  paymentStatus: "paid" | "unpaid";
  paymentMethod: PaymentMethod | null;
  paymentMethodLabel: string | null;
  paidAt: string | null;
  supplierId: number | null;
  supplierName: string | null;
  status: "active" | "disposed";
  disposedAt: string | null;
  disposedReason: string | null;
  accumulatedDepreciation: number;
  bookValue: number;
  createdAt: string;
};

export function listFixedAssets(accessToken: string) {
  return apiFetch<{ fixedAssets: FixedAsset[] }>("/api/accounting/fixed-assets", { accessToken });
}

export type CreateFixedAssetInput = {
  label: string;
  category: FixedAssetCategory;
  acquisitionDate: string;
  acquisitionCost: number;
  usefulLifeYears: number;
  /** "paid" (défaut) : réglée immédiatement — requiert `paymentMethod`. "unpaid" : à crédit — requiert `supplierName`. */
  paymentStatus?: "paid" | "unpaid";
  paymentMethod?: PaymentMethod;
  supplierName?: string;
  /** Clé d'idempotence de CET envoi (voir `useIdempotencyKey`). */
  idempotencyKey?: string;
};

export function createFixedAsset(accessToken: string, input: CreateFixedAssetInput) {
  return apiFetch<{ fixedAssetId: number }>("/api/accounting/fixed-assets", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type FixedAssetDepreciationEntry = { period: string; amount: number; recordedBy: Actor; createdAt: string };

export function getFixedAsset(accessToken: string, id: number) {
  return apiFetch<{ fixedAsset: FixedAsset; depreciations: FixedAssetDepreciationEntry[] }>(
    `/api/accounting/fixed-assets/${id}`,
    { accessToken },
  );
}

/** Solde une immobilisation "à crédit" — génère le règlement comptable (481). */
export function payFixedAsset(accessToken: string, id: number, input: { paymentMethod: PaymentMethod; paidAt: string }) {
  return apiFetch<void>(`/api/accounting/fixed-assets/${id}/pay`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Enregistre un mois d'amortissement (acte saisi, jamais automatique). */
export function depreciateFixedAsset(accessToken: string, id: number, period: string) {
  return apiFetch<{ depreciationId: number; amount: number; remainingBookValue: number }>(
    `/api/accounting/fixed-assets/${id}/depreciate`,
    {
      method: "POST",
      accessToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period }),
    },
  );
}

/**
 * Sort une immobilisation du patrimoine (vente, rebut, perte) — acte
 * DÉFINITIF (comme une clôture de mois), jamais réversible. Génère une
 * écriture comptable de sortie (amortissement cumulé soldé, valeur nette
 * comptable résiduelle passée en charge) si le module avancé est actif.
 */
export function disposeFixedAsset(accessToken: string, id: number, input: { disposedAt: string; reason: string }) {
  return apiFetch<{ fixedAssetId: number; disposedAt: string }>(`/api/accounting/fixed-assets/${id}/dispose`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ── Bilan détaillé d'un mois (GET /api/accounting/month-bilan/:month) ─────────────────────────────

export type MonthBilanLines = Record<string, number>;
export type MonthBilanProperty = {
  propertyId: number;
  propertyCode: string;
  ownerId: number;
  ownerName: string;
  rent: number;
  openingDebt: number;
  prorata: number;
  expenses: number;
  netRevenue: number;
  commission: number;
  ownerShare: number;
};
export type MonthBilanOwner = {
  ownerId: number;
  ownerName: string;
  openingBalance: number;
  collected: number;
  expenses: number;
  commission: number;
  payouts: number;
  closingBalance: number;
  status: "reverse" | "non_reverse";
};
export type MonthBilanTenant = {
  leaseId: number;
  renterName: string;
  propertyCode: string;
  unitCode: string;
  monthlyRent: number;
  daysLate: number;
  unpaidMonths: number;
  openingDebtRemaining: number;
  lateFeesRemaining: number;
  amountOwed: number;
};
export type MonthBilan = {
  month: string;
  from: string;
  to: string;
  isFuture: boolean;
  commissionTiming: "encaissement" | "reversement";
  inflows: {
    total: number;
    lines: MonthBilanLines;
    rent: {
      total: number;
      count: number;
      ceMois: number;
      arriere: number;
      avance: number;
      fromDeposit: number;
      cashTotal: number;
      byMethod: { method: string; total: number; count: number }[];
    };
    counts: Record<string, number>;
  };
  outflows: { total: number; lines: MonthBilanLines; counts: Record<string, number> };
  /** Cautions remises aux propriétaires (ou récupérées) : suivi mensuel, à restituer aux locataires. */
  depositTransfers?: {
    month: { toOwners: number; fromOwners: number };
    lines: {
      id: number; ownerId: number; ownerName: string; direction: "to_owner" | "from_owner";
      depositType: string; amount: number; paidAt: string; motive: string; requestedByOwner: boolean; renterName: string;
    }[];
    stillWithOwners: { total: number; owners: { ownerId: number; ownerName: string; amount: number }[] };
  };
  treasury: { in: number; out: number; net: number };
  cabinet: {
    commission: number;
    entryFees: number;
    lateFees: number;
    saleCommissions: number;
    otherIncomes?: number;
    expenses: number;
    netIncome: number;
  };
  properties: MonthBilanProperty[];
  owners: MonthBilanOwner[];
  tenants: { asOf: string; totalOwed: number; count: number; list: MonthBilanTenant[] };
  expenses: {
    cabinetTotal: number;
    propertyTotal: number;
    byCategory: { category: string; total: number; count: number }[];
    lines: { id: number; label: string; category: string; amount: number; paidAt: string; propertyCode: string | null }[];
    engagedUnpaid: { total: number; count: number };
  };
  charges: {
    billed: { total: number; count: number };
    collected: { total: number; count: number };
    remitted: { total: number; count: number };
    unpaidAtEndOfMonth: { total: number; count: number };
  };
  controls: { key: string; label: string; ok: boolean; expected: number; actual: number }[];
  allControlsOk: boolean;
};

export type MonthBilanResponse = {
  source: "snapshot" | "live";
  frozenAt?: string;
  isClosed: boolean;
  /** Mois clôturé dont la reconstruction actuelle diffère de la photo figée (régularisation postérieure). */
  drift: boolean;
  bilan: MonthBilan;
  live?: MonthBilan;
};

export function getMonthBilan(accessToken: string, month: string) {
  return apiFetch<MonthBilanResponse>(`/api/accounting/month-bilan/${encodeURIComponent(month)}`, { accessToken });
}

// ── Autres entrées d'argent du cabinet ────────────────────────────────────────

export type IncomeCategory = "prestation" | "commission" | "interets" | "remboursement" | "subvention_don" | "autre";

export type OtherIncome = {
  id: number;
  category: IncomeCategory;
  categoryLabel: string;
  label: string;
  amount: number;
  incomeDate: string;
  paymentMethod: "especes" | "mobile_money" | "virement" | "cheque";
  paymentMethodLabel: string;
  payerName: string | null;
  reference: string | null;
  notes: string | null;
  receiptUrl: string | null;
  recordedBy: Actor | null;
  createdAt: string;
};

export function listOtherIncomes(accessToken: string, filters?: { from?: string; to?: string; category?: IncomeCategory; q?: string }) {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.q) params.set("q", filters.q);
  const qs = params.toString();
  return apiFetch<{ incomes: OtherIncome[]; total: number }>(`/api/accounting/incomes${qs ? `?${qs}` : ""}`, { accessToken });
}

export type CreateOtherIncomeInput = {
  category: IncomeCategory;
  label: string;
  amount: number;
  incomeDate: string;
  paymentMethod: OtherIncome["paymentMethod"];
  payerName?: string;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
  receipt?: File | null;
};

export function createOtherIncome(accessToken: string, input: CreateOtherIncomeInput) {
  const fd = new FormData();
  fd.append("category", input.category);
  fd.append("label", input.label);
  fd.append("amount", String(input.amount));
  fd.append("incomeDate", input.incomeDate);
  fd.append("paymentMethod", input.paymentMethod);
  if (input.payerName) fd.append("payerName", input.payerName);
  if (input.reference) fd.append("reference", input.reference);
  if (input.notes) fd.append("notes", input.notes);
  if (input.idempotencyKey) fd.append("idempotencyKey", input.idempotencyKey);
  if (input.receipt) fd.append("receipt", input.receipt);
  return apiFetch<{ incomeId: number }>("/api/accounting/incomes", { method: "POST", accessToken, body: fd });
}

export function deleteOtherIncome(accessToken: string, id: number, reason: string) {
  return apiFetch<{ ok: boolean }>(`/api/accounting/incomes/${id}`, {
    method: "DELETE",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}
