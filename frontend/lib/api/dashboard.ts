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
      status: "ouverte" | "en_cours" | "resolue" | "fermee";
      statusLabel: string;
      reportedAt: string;
      renterName: string;
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

export function listActivity(accessToken: string, limit?: number) {
  const qs = limit ? `?limit=${limit}` : "";
  return apiFetch<{ entries: ActivityEntry[] }>(`/api/dashboard/activity${qs}`, { accessToken });
}
