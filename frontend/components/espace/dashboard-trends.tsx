"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import { getDashboardTrends, type DashboardTrends } from "@/lib/api/dashboard";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants/expenses";
import { monthLabel } from "@/lib/chart-utils";
import { formatFcfa } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthlyBars, type ChartSegment } from "@/components/charts/monthly-bars";
import { CumulLines } from "@/components/charts/cumul-lines";

const RANGES = [6, 12];
const RENT: ChartSegment[] = [{ key: "rent", label: "Loyers encaissés", className: "bg-primary" }];
const RENT_VS_ARREARS: ChartSegment[] = [
  { key: "rent", label: "Loyers encaissés", className: "bg-success-fg" },
  { key: "arrears", label: "Impayés à la fin du mois", className: "bg-danger-fg" },
];
const INCOME: ChartSegment[] = [
  { key: "commission", label: "Commissions", className: "bg-primary" },
  { key: "entryFees", label: "Frais d'entrée", className: "bg-success-fg" },
  { key: "lateFees", label: "Pénalités", className: "bg-warning-fg" },
  { key: "saleCommissions", label: "Ventes", className: "bg-danger-fg" },
  { key: "otherIncomes", label: "Autres entrées", className: "bg-ink-faint" },
];
const OCCUPANCY: ChartSegment[] = [{ key: "rate", label: "Taux d'occupation", className: "bg-primary" }];
const EXPENSE_CLASSES = ["bg-primary", "bg-success-fg", "bg-warning-fg", "bg-danger-fg"];

type Point = DashboardTrends["series"][number];

/** Évolution mois par mois, réservée au DG : mêmes calculs que la comptabilité (voir backend/services/dashboardTrends.js). */
export function DashboardTrendsSection({ accessToken }: { accessToken: string | null }) {
  const [months, setMonths] = React.useState(6);
  const [data, setData] = React.useState<DashboardTrends | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    setError(null);
    getDashboardTrends(accessToken, months).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Évolution indisponible."));
  }, [accessToken, months]);
  React.useEffect(() => load(), [load]);

  const expenseSegments = React.useMemo<ChartSegment[]>(() => {
    if (!data) return [];
    const totals = new Map<string, number>();
    for (const s of data.series) for (const [k, v] of Object.entries(s.expensesByCategory)) totals.set(k, (totals.get(k) ?? 0) + v);
    const top = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, EXPENSE_CLASSES.length);
    return [
      ...top.map(([k], i) => ({ key: k, label: EXPENSE_CATEGORY_LABELS[k as keyof typeof EXPENSE_CATEGORY_LABELS] ?? k, className: EXPENSE_CLASSES[i] })),
      { key: "__other", label: "Autres catégories", className: "bg-ink-faint" },
    ];
  }, [data]);

  if (error) return <p role="alert" className="text-body-sm text-danger-fg">{error} <Button variant="ghost" onClick={load}>Réessayer</Button></p>;
  if (!data) return <p className="text-body-md text-ink-muted">Chargement de l&apos;évolution…</p>;

  const topKeys = new Set(expenseSegments.map((g) => g.key));
  const expenseOf = (s: Point, key: string) =>
    key === "__other" ? Object.entries(s.expensesByCategory).filter(([k]) => !topKeys.has(k)).reduce((a, [, v]) => a + v, 0) : s.expensesByCategory[key] ?? 0;
  const last = data.series[data.series.length - 1];

  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-trends">
      <div className="flex items-center justify-between gap-2">
        <p className="text-body-sm text-ink-muted">Sur {data.months} mois, jusqu&apos;à aujourd&apos;hui.</p>
        <div className="flex gap-1.5" role="group" aria-label="Période">
          {RANGES.map((r) => <Button key={r} variant={months === r ? "primary" : "secondary"} onClick={() => setMonths(r)}>{r} mois</Button>)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Loyers encaissés par mois</CardTitle>
            <CardDescription>Total des loyers reçus chaque mois, à la date du paiement.</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyBars series={data.series} segments={RENT} value={(s) => s.rentCollected} testId="trend-rent"
              tip={(s) => `${monthLabel(s.month)} : ${formatFcfa(s.rentCollected)} · ${s.rentPayments} paiement${s.rentPayments > 1 ? "s" : ""}`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ce mois contre le mois précédent</CardTitle>
            <CardDescription>Loyers cumulés jour par jour : comparaison à la même date.</CardDescription>
          </CardHeader>
          <CardContent><CumulLines daily={data.daily} testId="trend-cumul" /></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Loyers encaissés et impayés</CardTitle>
            <CardDescription>Impayés des locataires tels qu&apos;ils étaient à la fin de chaque mois ({last ? `${last.arrearsCount} locataire${last.arrearsCount > 1 ? "s" : ""} en retard en ce moment` : ""}).</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyBars series={data.series} segments={RENT_VS_ARREARS} grouped value={(s, k) => (k === "rent" ? s.rentCollected : s.arrears)} testId="trend-arrears"
              tip={(s) => `${monthLabel(s.month)} : encaissé ${formatFcfa(s.rentCollected)} · impayés ${formatFcfa(s.arrears)} (${s.arrearsCount} locataire${s.arrearsCount > 1 ? "s" : ""})`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Occupation des unités</CardTitle>
            <CardDescription>Part des unités ayant un bail en cours à la fin de chaque mois.</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyBars series={data.series} segments={OCCUPANCY} unit="percent" value={(s) => (s.occupancy.rate ?? 0) * 100} testId="trend-occupancy"
              tip={(s) => `${monthLabel(s.month)} : ${s.occupancy.rate === null ? "aucune unité" : `${Math.round(s.occupancy.rate * 100)} % (${s.occupancy.occupied} louée${s.occupancy.occupied > 1 ? "s" : ""} sur ${s.occupancy.total})`}`} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recette du cabinet par mois</CardTitle>
            <CardDescription>Ce que gagne le cabinet : commissions, frais d&apos;entrée, pénalités, ventes et autres entrées. Le net (après dépenses) s&apos;affiche au survol.</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyBars series={data.series} segments={INCOME} value={(s, k) => s.revenue[k as keyof Point["revenue"]]} testId="trend-revenue"
              tip={(s) => `${monthLabel(s.month)} : entrées ${formatFcfa(s.revenue.net + s.revenue.expenses)} − dépenses ${formatFcfa(s.revenue.expenses)} = net ${formatFcfa(s.revenue.net)}`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dépenses du cabinet par mois</CardTitle>
            <CardDescription>Dépenses réellement payées, par catégorie (les 4 plus importantes de la période).</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyBars series={data.series} segments={expenseSegments} value={expenseOf} testId="trend-expenses"
              tip={(s) => `${monthLabel(s.month)} : ${formatFcfa(s.revenue.expenses)} de dépenses`} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
