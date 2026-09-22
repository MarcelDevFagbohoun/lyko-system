import { apiFetch, type Actor } from "./client";
import type { PaymentMethod } from "./renters";

// ── Plan comptable ──────────────────────────────────────────────────────

export type GlAccountType = "actif" | "passif" | "charge" | "produit" | "autre";

export type GlAccount = {
  id: number;
  code: string;
  /** Non-null uniquement pour les 2 comptes "renommables" — voir RENAMEABLE_SYSTEM_ACCOUNTS. */
  systemKey: string | null;
  label: string;
  class: number;
  accountType: GlAccountType;
  isControlAccount: boolean;
  parentAccountId: number | null;
  isSystem: boolean;
  isActive: boolean;
};

export function listGlAccounts(accessToken: string) {
  return apiFetch<{ accounts: GlAccount[] }>("/api/gl/accounts", { accessToken });
}

/**
 * Renomme un compte SYSTÈME "renommable" (numéro qui fait débat entre
 * cabinets comptables, ex. 4671 propriétaires mandants) — DG uniquement,
 * jamais son libellé/type. Voir RENAMEABLE_SYSTEM_ACCOUNTS pour la liste.
 */
export function renameGlSystemAccount(accessToken: string, key: string, code: string) {
  return apiFetch<void>(`/api/gl/accounts/renameable/${key}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export type CreateGlAccountInput = {
  code: string;
  label: string;
  class: number;
  accountType: GlAccountType;
  isControlAccount?: boolean;
  parentAccountId?: number;
};

export function createGlAccount(accessToken: string, input: CreateGlAccountInput) {
  return apiFetch<{ accountId: number }>("/api/gl/accounts", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ── Journaux ─────────────────────────────────────────────────────────────

export type GlJournal = { id: number; code: string; label: string; isSystem: boolean; isActive: boolean };

export function listGlJournals(accessToken: string) {
  return apiFetch<{ journals: GlJournal[] }>("/api/gl/journals", { accessToken });
}

// ── Exercices comptables ─────────────────────────────────────────────────

export type GlFiscalYear = {
  id: number;
  label: string;
  startDate: string;
  endDate: string;
  status: "ouvert" | "cloture";
  closedAt: string | null;
};

export function listGlFiscalYears(accessToken: string) {
  return apiFetch<{ fiscalYears: GlFiscalYear[] }>("/api/gl/fiscal-years", { accessToken });
}

export function createGlFiscalYear(accessToken: string, input: { label: string; startDate: string; endDate: string }) {
  return apiFetch<{ fiscalYearId: number }>("/api/gl/fiscal-years", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function closeGlFiscalYear(accessToken: string, id: number) {
  return apiFetch<{ totalDebit: number; totalCredit: number }>(`/api/gl/fiscal-years/${id}/close`, {
    method: "POST",
    accessToken,
  });
}

// ── Règles comptables (moteur d'écritures) ────────────────────────────────

export type GlPostingRuleLine = {
  side: "debit" | "credit";
  accountCode: string | null;
  accountLabel: string | null;
  accountRole: string | null;
  amountFormula: "montant_total" | "pourcentage_variable" | "montant_moins_pourcentage" | "montant_fixe";
  formulaParam: string | null;
  fixedAmount: number | null;
};

export type GlPostingRule = {
  id: number;
  operationType: string;
  label: string;
  journal: { code: string; label: string };
  narrationTemplate: string;
  isActive: boolean;
  isValidatedByAccountant: boolean;
  lines: GlPostingRuleLine[];
};

export function listGlPostingRules(accessToken: string) {
  return apiFetch<{ rules: GlPostingRule[] }>("/api/gl/posting-rules", { accessToken });
}

export function updateGlPostingRule(
  accessToken: string,
  id: number,
  input: Partial<{ label: string; narrationTemplate: string; isActive: boolean; isValidatedByAccountant: boolean }>,
) {
  return apiFetch<{ ruleId: number }>(`/api/gl/posting-rules/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * Ajoute les règles des types d'opération apparus depuis l'activation (ou
 * depuis la dernière resynchronisation), sans jamais toucher une règle déjà
 * présente. Nécessaire quand le module reste actif en continu (la
 * réactivation après suspension ne resynchronise pas non plus).
 */
export function resyncGlPostingRules(accessToken: string) {
  return apiFetch<{ added: string[]; updatedSystemKeys: string[] }>("/api/gl/posting-rules/resync", {
    method: "POST",
    accessToken,
  });
}

// ── Écritures ────────────────────────────────────────────────────────────

export type GlEntryStatus = "brouillon" | "validee" | "extournee";

export type GlEntry = {
  id: number;
  entryNumber: number;
  pieceNumber: number;
  entryDate: string;
  narration: string;
  journal: { code: string; label: string };
  sourceOperationType: string | null;
  sourceTable: string | null;
  sourceId: number | null;
  status: GlEntryStatus;
  reversesEntryId: number | null;
  reversedByEntryId: number | null;
  createdBy: Actor;
  createdAt: string;
};

export function listGlEntries(accessToken: string, filters?: { from?: string; to?: string; journalId?: number; status?: GlEntryStatus }) {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.journalId) params.set("journalId", String(filters.journalId));
  if (filters?.status) params.set("status", filters.status);
  const qs = params.toString();
  return apiFetch<{ entries: GlEntry[] }>(`/api/gl/entries${qs ? `?${qs}` : ""}`, { accessToken });
}

export type GlEntryLine = {
  side: "debit" | "credit";
  amount: number;
  accountCode: string;
  accountLabel: string;
  thirdParty: { name: string; auxiliaryCode: string } | null;
  paymentMethod: string | null;
};

export function getGlEntry(accessToken: string, id: number) {
  return apiFetch<{ entry: GlEntry; lines: GlEntryLine[] }>(`/api/gl/entries/${id}`, { accessToken });
}

export type CreateManualEntryLineInput = { accountId: number; thirdPartyId?: number; side: "debit" | "credit"; amount: number };

export function createManualGlEntry(
  accessToken: string,
  input: { journalId: number; entryDate: string; narration: string; lines: CreateManualEntryLineInput[] },
) {
  return apiFetch<{ entryId: number; entryNumber: number }>("/api/gl/entries/manual", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function extourneGlEntry(accessToken: string, id: number, input: { entryDate: string; reason: string }) {
  return apiFetch<{ reversalId: number; reversalEntryNumber: number; originalEntryId: number }>(
    `/api/gl/entries/${id}/extourne`,
    {
      method: "POST",
      accessToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

// ── États (balance, grand livre, tiers) ───────────────────────────────────

export type TrialBalanceLine = {
  accountId: number;
  code: string;
  label: string;
  accountType: GlAccountType;
  totalDebit: number;
  totalCredit: number;
  balance: number;
};

export function getTrialBalance(accessToken: string, fiscalYearId: number) {
  return apiFetch<{ lines: TrialBalanceLine[]; totals: { totalDebit: number; totalCredit: number } }>(
    `/api/gl/reports/trial-balance?fiscalYearId=${fiscalYearId}`,
    { accessToken },
  );
}

export type GeneralLedgerMovement = {
  entryDate: string;
  entryNumber: number;
  narration: string;
  thirdPartyName: string | null;
  debit: number | null;
  credit: number | null;
  runningBalance: number;
};

export function getGeneralLedger(accessToken: string, accountId: number, filters?: { from?: string; to?: string }) {
  const params = new URLSearchParams({ accountId: String(accountId) });
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  return apiFetch<{ account: { id: number; code: string; label: string }; movements: GeneralLedgerMovement[]; finalBalance: number }>(
    `/api/gl/reports/general-ledger?${params.toString()}`,
    { accessToken },
  );
}

export type ThirdPartyType = "renter" | "owner" | "supplier" | "employee" | "other";

export type ThirdPartyBalanceLine = {
  id: number;
  auxiliaryCode: string;
  displayName: string;
  // Un même tiers peut apparaître sur plusieurs comptes (ex. un locataire :
  // sa créance de loyer sous 411, sa caution sous 165) — deux dettes
  // distinctes, jamais fondues en une seule ligne.
  controlAccount: { code: string; label: string };
  totalDebit: number;
  totalCredit: number;
  balance: number;
};

// Indicateur de séparation des fonds mandants/cabinet (dernier des 6 points
// de complétude) : la trésorerie réelle, cumulée depuis toujours (pas
// bornée à l'exercice ouvert), doit couvrir les fonds détenus pour le
// compte de tiers (propriétaires en attente de reversement + cautions
// locataires non restituées) — voir le raisonnement détaillé côté serveur
// (`services/gl/glMandantsCabinetService.js`).
export type MandantsCabinetIndicator = {
  treasury: { banque: number; caisse: number; mobileMoney: number; total: number };
  dueToOwners: number;
  depositsHeld: number;
  fundsHeldForThirdParties: number;
  /** trésorerie totale − fonds de tiers ; négatif = signal de non-conformité. */
  coverage: number;
};

export function getMandantsCabinetIndicator(accessToken: string) {
  return apiFetch<MandantsCabinetIndicator>("/api/gl/reports/mandants-cabinet", { accessToken });
}

export function getThirdPartyBalance(accessToken: string, partyType: ThirdPartyType) {
  return apiFetch<{ thirdParties: ThirdPartyBalanceLine[] }>(`/api/gl/reports/third-party-balance?partyType=${partyType}`, {
    accessToken,
  });
}

// ── États financiers SYSCOHADA (livrable 8) ───────────────────────────────

export type IncomeStatementLine = { code: string; label: string; amount: number };

export type IncomeStatement = {
  produits: IncomeStatementLine[];
  charges: IncomeStatementLine[];
  totalProduits: number;
  totalCharges: number;
  resultatNet: number;
};

export function getIncomeStatement(accessToken: string, fiscalYearId: number) {
  return apiFetch<IncomeStatement>(`/api/gl/reports/income-statement?fiscalYearId=${fiscalYearId}`, { accessToken });
}

export type BalanceSheetLine = { code: string; label: string; amount: number };

export type BalanceSheet = {
  actif: BalanceSheetLine[];
  passif: BalanceSheetLine[];
  resultatNet: number;
  totalActif: number;
  totalPassif: number;
  balanced: boolean;
};

export function getBalanceSheet(accessToken: string, fiscalYearId: number) {
  return apiFetch<BalanceSheet>(`/api/gl/reports/balance-sheet?fiscalYearId=${fiscalYearId}`, { accessToken });
}

export type CashFlowStatement = {
  openingBalance: number;
  totalInflows: number;
  totalOutflows: number;
  closingBalance: number;
  netVariation: number;
};

export function getCashFlow(accessToken: string, from: string, to: string) {
  return apiFetch<CashFlowStatement>(`/api/gl/reports/cash-flow?from=${from}&to=${to}`, { accessToken });
}

/** États financiers combinés (bilan + compte de résultat + flux) — export PDF, en-tête du cabinet. */
export function financialStatementsPdfPath(fiscalYearId: number) {
  return `/api/gl/reports/financial-statements.pdf?fiscalYearId=${fiscalYearId}`;
}

/** Même contenu, un onglet Excel par état. */
export function financialStatementsXlsxPath(fiscalYearId: number) {
  return `/api/gl/reports/financial-statements.xlsx?fiscalYearId=${fiscalYearId}`;
}

// ── Activation / suspension (DG uniquement) ───────────────────────────────

export type GlActivationStatus = {
  initialized: boolean;
  enabled: boolean;
  earliestOperation: string | null;
  accountingStartDate: string | null;
};

export function getGlActivationStatus(accessToken: string) {
  return apiFetch<GlActivationStatus>("/api/gl/activation/status", { accessToken });
}

export type GlActivationResult = {
  wasAlreadyInitialized: boolean;
  fromDate: string;
  fiscalYearsCreated: { id: number; label: string; startDate: string; endDate: string }[];
  entriesGenerated: number;
  entriesSkipped: number;
  errors: string[];
};

export function activateGlModule(accessToken: string) {
  return apiFetch<GlActivationResult>("/api/gl/activation/activate", { method: "POST", accessToken });
}

export function deactivateGlModule(accessToken: string) {
  return apiFetch<void>("/api/gl/activation/deactivate", { method: "POST", accessToken });
}

// ── Notifications DG ───────────────────────────────────────────────────────

export type GlNotification = {
  id: number;
  type: string;
  message: string;
  entityTable: string | null;
  entityId: number | null;
  readAt: string | null;
  createdAt: string;
};

export function listGlNotifications(accessToken: string, unreadOnly?: boolean) {
  return apiFetch<{ unreadCount: number; notifications: GlNotification[] }>(
    `/api/gl/notifications${unreadOnly ? "?unreadOnly=true" : ""}`,
    { accessToken },
  );
}

export function markGlNotificationRead(accessToken: string, id: number) {
  return apiFetch<void>(`/api/gl/notifications/${id}/read`, { method: "PATCH", accessToken });
}

export function markAllGlNotificationsRead(accessToken: string) {
  return apiFetch<void>("/api/gl/notifications/read-all", { method: "PATCH", accessToken });
}

// ── Réglages de la comptabilité avancée ───────────────────────────────────
// Hypothèses de jugement comptable restées configurables par entreprise
// (voir les notes "À VALIDER" du seed) plutôt que devinées une fois pour
// toutes — ouvert au DG ET au comptable autorisé, comme les comptes
// renommables.

export type GlSettings = {
  /** Si actif, le mois d'acquisition d'une immobilisation est proratisé au nombre de jours restants (jour inclus) plutôt qu'un mois plein. */
  depreciationProrataTemporis: boolean;
  /** % d'une charge SONEB/SBEE encaissée répercuté au locataire (411) ; le reste est gardé par le cabinet (706) comme frais de gestion. 100 = comportement historique (tout répercuté). */
  utilityPassThroughPercent: number;
  /** Moment où la commission du cabinet (706) est comptabilisée : "encaissement" (défaut, historique) ou "reversement" (reportée au versement effectif au propriétaire). */
  commissionTiming: "encaissement" | "reversement";
  /** IRF (Impôt sur le Revenu Foncier) : si actif, une retenue est prélevée sur chaque reversement au propriétaire, au taux `irfRate` (%). */
  irfEnabled: boolean;
  irfRate: number;
};

export function getGlSettings(accessToken: string) {
  return apiFetch<GlSettings>("/api/gl/settings", { accessToken });
}

export function updateGlSettings(accessToken: string, input: Partial<GlSettings>) {
  return apiFetch<GlSettings>("/api/gl/settings", {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ── IRF (Impôt sur le Revenu Foncier) ─────────────────────────────────────
// Retenue à la source accumulée sur le compte 442 à chaque reversement
// propriétaire (si activé) — à reverser au fisc à son propre rythme,
// jamais automatique. Voir GlSettings.irfEnabled/irfRate pour l'activation.

export function getIrfBalance(accessToken: string) {
  return apiFetch<{ balanceOwed: number }>("/api/gl/irf", { accessToken });
}

export function payIrf(accessToken: string, input: { amount: number; paymentMethod: PaymentMethod; paidAt: string }) {
  return apiFetch<{ entryId: number }>("/api/gl/irf/pay", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ── Rapprochement bancaire ─────────────────────────────────────────────────
// Compte banque unique (521) : virement/chèque y sont toujours résolus (voir
// backend `TREASURY_BY_PAYMENT_METHOD`) — jamais de sélection de compte côté
// client, un seul rapprochement possible par période.

export type BankReconciliationStatus = "en_cours" | "rapproche";

export type BankReconciliation = {
  id: number;
  period: string;
  statementBalance: number;
  bookBalance: number;
  /** statementBalance − bookBalance ; 0 = les comptes correspondent exactement au relevé. */
  gap: number;
  status: BankReconciliationStatus;
  reconciledAt: string | null;
  createdAt: string;
};

export function listBankReconciliations(accessToken: string) {
  return apiFetch<{ reconciliations: BankReconciliation[] }>("/api/gl/bank-reconciliations", { accessToken });
}

export function startBankReconciliation(accessToken: string, input: { period: string; statementBalance: number }) {
  return apiFetch<{ reconciliationId: number }>("/api/gl/bank-reconciliations", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateBankReconciliationStatement(accessToken: string, id: number, statementBalance: number) {
  return apiFetch<void>(`/api/gl/bank-reconciliations/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ statementBalance }),
  });
}

/** Mouvement comptable du compte banque, pointé ou non — jamais recalculé, toujours une écriture déjà enregistrée. */
export type BankReconciliationBookMovement = {
  entryLineId: number;
  entryDate: string;
  entryNumber: number;
  narration: string;
  side: "debit" | "credit";
  amount: number;
};

/** Une ligne saisie dans le rapprochement : soit le pointage d'un mouvement comptable, soit une opération vue seulement sur le relevé. */
export type BankReconciliationLine = {
  id: number;
  isMatched: boolean;
  bankReference: string | null;
  bankAmount: number;
  bankDate: string;
  entryLine: { entryDate: string; narration: string; side: "debit" | "credit"; amount: number } | null;
};

export type BankReconciliationDetail = {
  reconciliation: BankReconciliation;
  lines: BankReconciliationLine[];
  unmatchedBookMovements: BankReconciliationBookMovement[];
};

export function getBankReconciliation(accessToken: string, id: number) {
  return apiFetch<BankReconciliationDetail>(`/api/gl/bank-reconciliations/${id}`, { accessToken });
}

/** Pointe un mouvement comptable existant (`entryLineId`) — jamais combiné avec un montant/date de relevé distinct. */
export function pointBankMovement(accessToken: string, reconciliationId: number, entryLineId: number) {
  return apiFetch<{ lineId: number }>(`/api/gl/bank-reconciliations/${reconciliationId}/lines`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryLineId }),
  });
}

/** Enregistre une opération vue sur le relevé mais absente des comptes (ex. frais bancaires) — jamais créée automatiquement en dépense. */
export function addBankOnlyLine(
  accessToken: string,
  reconciliationId: number,
  input: { bankReference?: string; bankAmount: number; bankDate: string },
) {
  return apiFetch<{ lineId: number }>(`/api/gl/bank-reconciliations/${reconciliationId}/lines`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function removeBankReconciliationLine(accessToken: string, reconciliationId: number, lineId: number) {
  return apiFetch<void>(`/api/gl/bank-reconciliations/${reconciliationId}/lines/${lineId}`, {
    method: "DELETE",
    accessToken,
  });
}

/** Clôture définitive. `force: true` confirme malgré des mouvements non pointés ou un écart non nul. */
export function finalizeBankReconciliation(accessToken: string, id: number, force?: boolean) {
  return apiFetch<void>(`/api/gl/bank-reconciliations/${id}/finalize`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force: force ?? false }),
  });
}
