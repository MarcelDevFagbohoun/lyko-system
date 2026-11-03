import { apiFetch } from "./client";
import type { PortfolioArrearsEntry, PredictiveAlertEntry } from "./accounting";

/**
 * Tableau de bord « Mes tâches » (étape 18) : jamais pour le DG (son propre
 * tableau de bord existe déjà) — chaque section n'est renseignée que si
 * l'utilisateur a la permission correspondante (comptabilite / locataires).
 */
export type OpenComplaintTask = {
  id: number;
  code: string;
  title: string;
  priority: "normale" | "urgente";
  status: "ouverte" | "en_cours";
  reportedAt: string;
  renterName: string;
};

/**
 * Pour une sortie (migration 139), `reviewStatus` dit où en est la validation DG — demande
 * utilisateur du 2026-11-03 : l'employé doit voir sur cet écran si son PV soumis a été rejeté
 * (`reviewNote` porte le motif, à corriger) ou juste en attente de décision. `undefined` pour une
 * entrée (pas de circuit de revue) ou une sortie jamais soumise.
 */
export type DraftInspectionTask = {
  leaseId: number;
  renterId: number;
  kind: "move-in" | "move-out";
  renterName: string;
  unitCode: string;
  conductedAt: string;
  reviewStatus?: "draft" | "submitted" | "rejected" | "validated" | null;
  reviewNote?: string | null;
  submittedAt?: string | null;
};

/** PV de sortie soumis par un employé, en attente de validation DG — jamais peuplé pour un employé. */
export type PendingMoveOutReviewTask = {
  leaseId: number;
  renterId: number;
  renterName: string;
  unitCode: string;
  submittedAt: string;
  submittedByName: string | null;
};

export type AgentTasks = {
  lateRenters: PortfolioArrearsEntry[];
  predictiveAlerts: PredictiveAlertEntry[];
  openComplaints: OpenComplaintTask[];
  draftInspections: DraftInspectionTask[];
  pendingMoveOutReviews: PendingMoveOutReviewTask[];
};

export type PendingBatchTask = {
  id: number;
  utilityType: "soneb" | "sbee";
  periodStart: string;
  periodEnd: string;
  propertyCode: string;
};

export type ExpenseWithoutReceiptTask = {
  id: number;
  label: string;
  amount: number;
  expenseDate: string;
};

/** Restitution de caution avec retenue jamais comptabilisée (étape 48) — voir aussi le tableau de bord DG. */
export type PendingDepositRegularizationTask = {
  leaseId: number;
  renterId: number;
  renterName: string;
  totalDeductions: number;
  finalizedAt: string;
};

/** Décaissement de sortie en attente (migration 139) — même liste que côté tableau de bord DG. */
export type PendingMoveOutPayoutTask = {
  leaseId: number;
  renterId: number;
  renterName: string;
  direction: "refund_to_tenant" | "collect_from_tenant";
  amount: number;
  finalizedAt: string;
};

export type AccountantTasks = {
  pendingBatches: PendingBatchTask[];
  expensesWithoutReceipt: ExpenseWithoutReceiptTask[];
  currentMonthClosability: { period: string; isClosable: boolean } | null;
  pendingDepositRegularizations: PendingDepositRegularizationTask[];
  pendingMoveOutPayouts: PendingMoveOutPayoutTask[];
};

export type AssignedTaskSummary = {
  id: number;
  title: string;
  description: string | null;
  dueDate: string;
};

export type MyTasks = {
  agent: AgentTasks | null;
  accountant: AccountantTasks | null;
  // Tâches à délai assignées par le DG (nouveau) — indépendant des
  // permissions locataires/comptabilité, toujours présent.
  assignedTasks: AssignedTaskSummary[];
};

export function getMyTasks(accessToken: string) {
  return apiFetch<MyTasks>("/api/tasks", { accessToken });
}
