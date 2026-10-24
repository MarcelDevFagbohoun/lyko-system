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
  PiggyBank,
  ClipboardCheck,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { getDashboardOverview, type DashboardOverview } from "@/lib/api/dashboard";
import { getDashboard, type AccountingDashboard } from "@/lib/api/accounting";
import { formatFcfa, cn } from "@/lib/utils";
import { ClosingReminderBanner } from "@/components/accounting/closing-reminder-banner";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ComplaintsPanel, QuickAccessPanel } from "@/components/espace/dashboard-panels";
import { StatCard } from "@/components/ui/stat-card";
import { CADRES, type Cadre } from "@/lib/module-theme";

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

function greetingForHour(hour: number) {
  if (hour < 5) return "Bonsoir";
  if (hour < 18) return "Bonjour";
  return "Bonsoir";
}

/**
 * Tableau de bord DG (étape 10, refonte visuelle 2026-10-21 — demande utilisateur : « design créatif
 * et professionnel ») : vue d'ensemble multi-modules, désormais organisée en zones distinctes (une
 * mise en avant du chiffre qui compte le plus, puis des sections thématiques reprenant la couleur de
 * cadre de chaque rubrique — voir `lib/module-theme.ts`) plutôt qu'une seule grille plate de tuiles.
 * Réservé au DG, cohérent avec la maquette de référence « Supervision DG ».
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
  const [now] = React.useState(() => new Date());

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

  const dateLabel = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-8 py-10">
        <div className="flex flex-col gap-1">
          <p className="font-label-sm uppercase tracking-[0.2em] text-primary">{dateLabel}</p>
          <h1 className="font-display text-headline-xl text-ink">
            {greetingForHour(now.getHours())}, {user?.firstName}
          </h1>
          <p className="text-body-md text-ink-soft">Vue d&apos;ensemble de votre entreprise, mois en cours.</p>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        <ClosingReminderBanner accessToken={accessToken} />

        {money?.cabinetRevenue && <NetRevenueHero cabinetRevenue={money.cabinetRevenue} />}

        {overview && (
          <DashboardSection
            cadre="patrimoine"
            title="Patrimoine"
            description="Votre parc immobilier, en un coup d'œil."
          >
            <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              <StatCard
                label="États des lieux en brouillon"
                icon={<ClipboardCheck size={16} />}
                value={overview.inspections.draftMoveInCount + overview.inspections.draftMoveOutCount}
                tone={overview.inspections.draftMoveInCount + overview.inspections.draftMoveOutCount > 0 ? "warning" : "success"}
                trend={{
                  value: `${overview.inspections.draftMoveInCount} entrée(s) · ${overview.inspections.draftMoveOutCount} sortie(s) · ${overview.inspections.moveOutsThisMonthCount} sortie(s) ce mois`,
                  direction: "flat",
                }}
              />
            </div>
          </DashboardSection>
        )}

        {money && (
          <DashboardSection cadre="finances" title="Finances du mois" description="Ce qui est entré, ce qui reste dû.">
            <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Loyers encaissés"
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
                label="Trésorerie réelle"
                icon={<Scale size={16} />}
                value={formatFcfa(money.totals.treasuryNet ?? money.totals.netCashFlow)}
                tone={(money.totals.treasuryNet ?? money.totals.netCashFlow) >= 0 ? "success" : "danger"}
                trend={{
                  value:
                    money.totals.treasuryNet != null
                      ? `${formatFcfa(money.totals.treasuryIn ?? 0)} entrés − ${formatFcfa(money.totals.treasuryOut ?? 0)} sortis`
                      : "Encaissé, moins reversé et dépenses",
                  direction: (money.totals.treasuryNet ?? money.totals.netCashFlow) >= 0 ? "up" : "down",
                }}
              />
            </div>
          </DashboardSection>
        )}

        <DashboardSection cadre="operations" title="À traiter" description="Ce qui demande votre attention aujourd'hui.">
          <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ComplaintsPanel
              loading={!overview}
              openCount={overview?.complaints.openCount ?? 0}
              items={overview?.complaints.recent ?? []}
            />

            {overview && overview.inspections.pendingDepositRegularizations.length > 0 && (
              <Card tone={CADRES.finances.tone} className="border-l-4 border-l-warning-strong">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-warning text-white">
                        <PiggyBank size={14} />
                      </span>
                      <CardTitle>Cautions à régulariser</CardTitle>
                    </div>
                    <Badge variant="warning">{overview.inspections.pendingDepositRegularizations.length}</Badge>
                  </div>
                  <CardDescription>
                    Sorties avec retenue sur caution, jamais comptabilisées (le sort comptable d&apos;une retenue
                    n&apos;est pas automatisé).
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {overview.inspections.pendingDepositRegularizations.map((d) => (
                    <Link
                      key={d.leaseId}
                      href={`/espace/locataires/${d.renterId}/sortie?leaseId=${d.leaseId}`}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 hover:bg-surface-hover"
                    >
                      <div>
                        <p className="font-label-md text-ink">{d.renterName}</p>
                        <p className="text-body-xs text-ink-muted">
                          Sortie finalisée le {new Date(d.finalizedAt).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                      <span className="tabular text-body-sm text-danger-fg">{formatFcfa(d.totalDeductions)}</span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            <QuickAccessPanel />
          </div>
        </DashboardSection>
      </div>
    </div>
  );
}

/**
 * Mise en avant du chiffre qui compte le plus (demande utilisateur, 2026-10-21 : design « créatif et
 * professionnel ») — la recette nette était auparavant la 9ᵉ tuile d'une grille plate, noyée parmi des
 * chiffres de nature très différente. Bandeau plein écran, aplat sombre, détail du calcul en légende
 * plutôt qu'une seule phrase à rallonge.
 */
function NetRevenueHero({ cabinetRevenue }: { cabinetRevenue: NonNullable<AccountingDashboard["cabinetRevenue"]> }) {
  const { breakdown, netCabinetIncome } = cabinetRevenue;
  const positive = netCabinetIncome >= 0;
  const items: { label: string; value: number; dot: string }[] = [
    { label: "Commission", value: breakdown.commission, dot: "bg-tint-blue-solid" },
    { label: "Frais d'agence", value: breakdown.entryFees, dot: "bg-tint-violet-solid" },
    { label: "Pénalités de retard", value: breakdown.lateFees, dot: "bg-tint-amber-solid" },
  ];
  if (breakdown.saleCommissions > 0) items.push({ label: "Commission sur ventes", value: breakdown.saleCommissions, dot: "bg-tint-teal-solid" });
  if ((breakdown.otherIncomes ?? 0) > 0) items.push({ label: "Autres entrées", value: breakdown.otherIncomes ?? 0, dot: "bg-tint-cyan-solid" });
  items.push({ label: "Dépenses de l'entreprise", value: -breakdown.expenses, dot: "bg-danger-strong" });

  return (
    <Card className="relative overflow-hidden border-transparent bg-ink text-white shadow-md">
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5 blur-2xl"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-primary/20 blur-2xl"
      />
      <CardContent className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-label-sm uppercase tracking-wider text-white/80">
            <Sparkles size={13} /> Recette nette de l&apos;entreprise
          </span>
          <span
            className={cn(
              "tabular font-display text-[2.75rem] leading-none tracking-tight sm:text-[3.25rem]",
              positive ? "text-white" : "text-danger-strong",
            )}
          >
            {formatFcfa(netCabinetIncome)}
          </span>
          <span className="text-body-sm text-white/70">Mois en cours — commission, frais &amp; produits divers, moins les dépenses de fonctionnement.</span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 lg:min-w-[22rem] lg:grid-cols-2">
          {items.map((it) => (
            <div key={it.label} className="flex items-center gap-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", it.dot)} aria-hidden />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-body-xs text-white/60">{it.label}</span>
                <span className={cn("tabular font-label-md", it.value < 0 ? "text-danger-strong" : "text-white")}>
                  {it.value < 0 ? "− " : ""}
                  {formatFcfa(Math.abs(it.value))}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** En-tête de section thématique — la couleur dit d'où viennent les chiffres qui suivent (voir CADRES). */
function DashboardSection({
  cadre,
  title,
  description,
  children,
}: {
  cadre: Cadre;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const theme = CADRES[cadre];
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className={cn("h-6 w-1.5 shrink-0 rounded-full", theme.solid)} aria-hidden />
        <div>
          <h2 className="font-display text-headline-sm text-ink">{title}</h2>
          <p className="text-body-xs text-ink-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
