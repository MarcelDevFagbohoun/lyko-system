import { apiFetch, type Actor } from "./client";

// Étape 10 (fonctionnalités transversales) — Tableau de bord DG : occupation
// du parc + plaintes en cours. Les chiffres financiers (loyers, impayés,
// dépenses...) viennent de `getDashboard` (lib/api/accounting.ts), déjà
// existant — cette page compose les deux réponses plutôt que de dupliquer
// le calcul côté serveur.

export type DashboardOverview = {
  units: { total: number; occupied: number; free: number; reserved: number; occupancyRate: number };
  propertiesCount: number;
  ownersCount: number;
  rentersCount: number;
  activeLeasesCount: number;
  complaints: {
    openCount: number;
    recent: {
      id: number;
      code: string;
      title: string;
      priority: "normale" | "urgente";
      status: "non_resolue" | "resolue";
      statusLabel: string;
      reportedAt: string;
      renterName: string;
    }[];
  };
  // Étape 48 (audit état des lieux) — vue portefeuille : brouillons laissés
  // en plan (tous agents confondus) + sorties du mois + restitutions de
  // caution avec retenue jamais comptabilisées, tant que personne ne les a
  // marquées réglées (voir aussi « Mes tâches » côté comptable).
  inspections: {
    draftMoveInCount: number;
    draftMoveOutCount: number;
    moveOutsThisMonthCount: number;
    pendingDepositRegularizations: {
      leaseId: number;
      renterId: number;
      renterName: string;
      totalDeductions: number;
      finalizedAt: string;
    }[];
  };
};

export function getDashboardOverview(accessToken: string) {
  return apiFetch<DashboardOverview>("/api/dashboard/overview", { accessToken });
}

export type ActivityEntry = {
  type: string;
  label: string;
  actor: Actor;
  at: string;
};

// `date` ('AAAA-MM-DD') et `month` ('AAAA-MM') sont mutuellement exclusifs
// côté serveur (date prioritaire) — l'appelant n'envoie jamais les deux.
export type ActivityFilters = { limit?: number; date?: string; month?: string; type?: string };

export function listActivity(accessToken: string, filters: ActivityFilters = {}) {
  const params = new URLSearchParams();
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.date) params.set("date", filters.date);
  else if (filters.month) params.set("month", filters.month);
  if (filters.type) params.set("type", filters.type);
  const qs = params.toString();
  return apiFetch<{ entries: ActivityEntry[] }>(`/api/dashboard/activity${qs ? `?${qs}` : ""}`, { accessToken });
}

export type DashboardTrends = {
  months: number;
  series: {
    month: string;
    rentCollected: number; rentPayments: number; arrears: number; arrearsCount: number;
    revenue: { commission: number; entryFees: number; lateFees: number; saleCommissions: number; otherIncomes: number; expenses: number; net: number };
    expensesByCategory: Record<string, number>;
    occupancy: { total: number; occupied: number; rate: number | null };
  }[];
  daily: { currentMonth: string; previousMonth: string; today: number; daysInCurrent: number; daysInPrevious: number; current: number[]; previous: number[] };
};
export function getDashboardTrends(accessToken: string, months = 6) {
  return apiFetch<DashboardTrends>(`/api/dashboard/trends?months=${months}`, { accessToken });
}
