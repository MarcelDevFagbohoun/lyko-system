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

export type DraftInspectionTask = {
  leaseId: number;
  renterId: number;
  kind: "move-in" | "move-out";
  renterName: string;
  unitCode: string;
  conductedAt: string;
};

export type AgentTasks = {
  lateRenters: PortfolioArrearsEntry[];
  predictiveAlerts: PredictiveAlertEntry[];
  openComplaints: OpenComplaintTask[];
  draftInspections: DraftInspectionTask[];
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

export type AccountantTasks = {
  pendingBatches: PendingBatchTask[];
  expensesWithoutReceipt: ExpenseWithoutReceiptTask[];
  currentMonthClosability: { period: string; isClosable: boolean } | null;
};

export type MyTasks = {
  agent: AgentTasks | null;
  accountant: AccountantTasks | null;
};

export function getMyTasks(accessToken: string) {
  return apiFetch<MyTasks>("/api/tasks", { accessToken });
}
