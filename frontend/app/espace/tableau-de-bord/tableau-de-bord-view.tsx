"use client";

import * as React from "react";
import Link from "next/link";
import {
  Building2,
  Users,
  FileSignature,
  TrendingUp,
  AlertTriangle,
  Droplets,
  Scale,
  MessageCircleWarning,
  History,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { getDashboardOverview, type DashboardOverview } from "@/lib/api/dashboard";
import { getDashboard, type AccountingDashboard } from "@/lib/api/accounting";
import { formatFcfa, cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";

/** Taux d'occupation : favorable au-delà de 85 %, à surveiller entre 50 et 85 %, préoccupant en-deçà. */
function occupancyTone(rate: number): "success" | "warning" | "danger" {
  if (rate >= 0.85) return "success";
  if (rate >= 0.5) return "warning";
  return "danger";
}

function currentMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

/**
 * Tableau de bord DG (étape 10) : vue d'ensemble multi-modules — occupation
 * du parc et plaintes en cours (calculées ici) composées avec les chiffres
 * financiers du mois en cours (réutilise `GET /api/accounting/dashboard`,
 * déjà existant, sans dupliquer le calcul). Réservé au DG, cohérent avec la
 * maquette de référence « Supervision DG ».
 */
export function TableauDeBordView() {
  return (
    <RequireAuth roles={["dg"]}>
      <TableauDeBordContent />
    </RequireAuth>
  );
}

function TableauDeBordContent() {
  const { accessToken, user } = useAuth();
  const [overview, setOverview] = React.useState<DashboardOverview | null>(null);
  const [money, setMoney] = React.useState<AccountingDashboard | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    const { from, to } = currentMonthRange();
    Promise.all([getDashboardOverview(accessToken), getDashboard(accessToken, from, to)])
      .then(([ov, m]) => {
        setOverview(ov);
        setMoney(m);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le tableau de bord."));
  }, [accessToken]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div>
          <h1 className="font-display text-headline-xl text-ink">Tableau de bord</h1>
          <p className="text-body-md text-ink-soft">
            Bonjour {user?.firstName}. Vue d&apos;ensemble de votre cabinet, mois en cours.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {overview && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Taux d'occupation"
              icon={<Building2 size={16} />}
              value={`${Math.round(overview.units.occupancyRate * 100)}%`}
              tone={occupancyTone(overview.units.occupancyRate)}
              trend={{
                value: `${overview.units.occupied} loué(s) / ${overview.units.total} unité(s) · ${overview.units.free} libre(s)`,
                direction: "flat",
              }}
            />
            <StatCard
              label="Baux actifs"
              icon={<FileSignature size={16} />}
              value={overview.activeLeasesCount}
              tone={overview.activeLeasesCount > 0 ? "success" : "warning"}
              trend={{ value: `${overview.rentersCount} locataire(s) au total`, direction: "flat" }}
            />
            <StatCard
              label="Portefeuille"
              icon={<Users size={16} />}
              value={overview.propertiesCount}
              tone={overview.propertiesCount > 0 ? "success" : "default"}
              trend={{ value: `${overview.ownersCount} propriétaire(s)`, direction: "flat" }}
            />

            {money && (
              <>
                <StatCard
                  label="Loyers encaissés (mois)"
                  icon={<TrendingUp size={16} />}
                  value={formatFcfa(money.totals.rentCollected)}
                  tone={money.totals.rentCollected > 0 ? "success" : "default"}
                  trend={{ value: `${money.totals.rentCollectedCount} paiement(s)`, direction: "flat" }}
                />
                <Link href="/espace/relances" className="group">
                  <StatCard
                    className="h-full transition-shadow group-hover:shadow-md"
                    label="Impayés locataires"
                    icon={<AlertTriangle size={16} />}
                    value={formatFcfa(money.totals.tenantArrears)}
                    tone={money.totals.tenantArrearsCount > 0 ? "danger" : "success"}
                    trend={{
                      value: `${money.totals.tenantArrearsCount} locataire(s) en retard`,
                      direction: "flat",
                    }}
                  />
                </Link>
                <StatCard
                  label="Impayés SONEB/SBEE"
                  icon={<Droplets size={16} />}
                  value={formatFcfa(money.totals.unpaidCharges)}
                  tone={money.totals.unpaidChargesCount > 0 ? "danger" : "success"}
                  trend={{ value: `${money.totals.unpaidChargesCount} facture(s)`, direction: "flat" }}
                />
                <StatCard
                  label="Solde net (mois)"
                  icon={<Scale size={16} />}
                  value={formatFcfa(money.totals.netCashFlow)}
                  tone={money.totals.netCashFlow >= 0 ? "success" : "danger"}
                  trend={{ value: "Encaissé, moins reversé et dépenses", direction: money.totals.netCashFlow >= 0 ? "up" : "down" }}
                />
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card
            className={cn(
              "border-l-4",
              overview && overview.complaints.openCount > 0 ? "border-l-danger-strong" : "border-l-success-strong",
            )}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-white",
                      overview && overview.complaints.openCount > 0 ? "bg-danger" : "bg-success",
                    )}
                  >
                    <MessageCircleWarning size={14} />
                  </span>
                  <CardTitle>Plaintes en cours</CardTitle>
                </div>
                <Badge variant={overview && overview.complaints.openCount > 0 ? "danger" : "success"}>
                  {overview ? overview.complaints.openCount : "…"}
                </Badge>
              </div>
              <CardDescription>Incidents non résolus, les plus urgents d&apos;abord.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {overview && overview.complaints.recent.length === 0 && (
                <p className="text-body-sm text-ink-muted">Aucune plainte en cours.</p>
              )}
              {overview?.complaints.recent.map((c) => (
                <Link
                  key={c.id}
                  href="/espace/plaintes"
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 hover:bg-surface-hover"
                >
                  <div>
                    <p className="font-label-md text-ink">
                      {c.code} · {c.title}
                    </p>
                    <p className="text-body-xs text-ink-muted">
                      {c.renterName} · {c.statusLabel} · signalée le {c.reportedAt}
                    </p>
                  </div>
                  <Badge variant={c.priority === "urgente" ? "danger" : "neutral"} dot={c.priority === "urgente"}>
                    {c.priority === "urgente" ? "Urgente" : "Normale"}
                  </Badge>
                </Link>
              ))}
              <Link href="/espace/plaintes" className="mt-1 inline-flex items-center gap-1 text-body-sm text-primary hover:underline">
                Voir toutes les plaintes <ArrowRight size={14} />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <History size={16} className="text-ink-muted" />
                <CardTitle>Accès rapides</CardTitle>
              </div>
              <CardDescription>Les autres vues transversales de votre espace.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Link href="/espace/relances" className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 hover:bg-surface-hover">
                <span className="text-body-sm text-ink">Centre de relance des impayés</span>
                <ArrowRight size={14} className="text-ink-muted" />
              </Link>
              <Link href="/espace/journal" className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 hover:bg-surface-hover">
                <span className="text-body-sm text-ink">Journal d&apos;activité</span>
                <ArrowRight size={14} className="text-ink-muted" />
              </Link>
              <Link href="/espace/comptabilite" className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 hover:bg-surface-hover">
                <span className="text-body-sm text-ink">Comptabilité détaillée</span>
                <ArrowRight size={14} className="text-ink-muted" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
