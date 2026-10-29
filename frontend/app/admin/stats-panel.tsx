"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import { adminStats, type AdminStats } from "@/lib/api/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateLabel, formatFcfa } from "@/lib/utils";
import { monthLabel } from "@/lib/chart-utils";
import { MonthlyBars, type ChartSegment } from "@/components/charts/monthly-bars";
import { CumulLines } from "@/components/charts/cumul-lines";

const PLAN_LABEL: Record<string, string> = { demarrage: "Démarrage", pro: "Pro", entreprise: "Entreprise", interne: "Interne", partenaire: "Partenaire" };
const KIND_LABEL: Record<string, string> = { purchase: "Premiers achats", renewal: "Renouvellements", upgrade: "Changements d'offre" };
const REASON_LABEL: Record<string, string> = { declined: "Refusé par l'opérateur", canceled: "Annulé par le client", abandoned: "Abandonné", incomplete: "Non terminé (plus de 2 h)", anomaly: "Anomalie : montant différent", unknown: "Autre" };
const RANGES = [6, 12, 24];

function trend(now: number, prev: number): { text: string; tone: "up" | "down" | "flat" } {
  if (prev === 0) return now === 0 ? { text: "Stable", tone: "flat" } : { text: "Nouveau ce mois", tone: "up" };
  const pct = Math.round(((now - prev) / prev) * 100);
  return pct === 0 ? { text: "Stable", tone: "flat" } : { text: `${pct > 0 ? "+" : ""}${pct} % vs mois précédent`, tone: pct > 0 ? "up" : "down" };
}

function Kpi({ label, value, hint, tone, testId }: { label: string; value: string; hint?: string; tone?: "success" | "danger" | "warning"; testId?: string }) {
  return (
    <Card tone={tone}>
      <CardContent className="flex flex-col gap-1 pt-4" data-testid={testId}>
        <p className="text-body-sm text-ink-soft">{label}</p>
        <p className="font-display text-headline-md text-ink break-words">{value}</p>
        {hint && <p className="text-body-xs text-ink-muted">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const PLAN_SEGMENTS: ChartSegment[] = [
  { key: "demarrage", label: "Démarrage", className: "bg-warning-fg" },
  { key: "pro", label: "Pro", className: "bg-primary" },
  { key: "entreprise", label: "Entreprise", className: "bg-success-fg" },
];
const KIND_SEGMENTS: ChartSegment[] = [
  { key: "purchase", label: "Nouveaux clients", className: "bg-primary" },
  { key: "renewal", label: "Renouvellements", className: "bg-success-fg" },
  { key: "upgrade", label: "Changements d'offre", className: "bg-warning-fg" },
];
const NET_SEGMENT: ChartSegment[] = [{ key: "net", label: "Recettes nettes", className: "bg-primary" }];

function Distribution({ rows, total }: { rows: { label: string; value: number; extra?: string }[]; total: number }) {
  if (rows.length === 0) return <p className="text-body-sm text-ink-muted">Aucune donnée sur la période.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-body-sm">
            <span className="text-ink">{r.label}</span>
            <span className="text-ink-soft">{r.extra}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${total ? Math.max(2, (r.value / total) * 100) : 0}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

const STATUS_BADGE: Record<string, { label: string; variant: "success" | "danger" | "warning" | "neutral" }> = {
  paid: { label: "Succès", variant: "success" },
  refunded: { label: "Remboursé", variant: "neutral" },
  failed: { label: "Échec", variant: "danger" },
  anomaly: { label: "Anomalie", variant: "danger" },
  pending: { label: "En attente", variant: "warning" },
};

export function StatsPanel({ token, onLogout, onOpenIssues }: { token: string; onLogout: () => void; onOpenIssues: () => void }) {
  const [months, setMonths] = React.useState(12);
  const [data, setData] = React.useState<AdminStats | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setError(null);
    adminStats(token, months).then(setData).catch((e) => {
      if (e instanceof ApiError && e.status === 401) onLogout(); else setError(e instanceof ApiError ? e.message : "Chargement impossible.");
    });
  }, [token, months, onLogout]);
  React.useEffect(() => load(), [load]);

  if (error) return <p role="alert" className="text-body-sm text-danger-fg">{error} <Button variant="ghost" onClick={load}>Réessayer</Button></p>;
  if (!data) return <p className="text-body-md text-ink-muted">Chargement…</p>;

  const k = data.kpis;
  const tr = trend(k.collectedMonth, k.collectedPrevMonth);
  const periodTotal = data.series.reduce((a, s) => a + s.net, 0);
  const periodCount = data.series.reduce((a, s) => a + s.payments, 0);
  const issuesCount = k.failed30 + k.incomplete30 + k.anomalies;

  return (
    <div className="flex flex-col gap-6" data-testid="stats-panel">
      {k.anomalies > 0 && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger-border bg-danger-bg p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-sm text-danger-fg"><strong>{k.anomalies} anomalie{k.anomalies > 1 ? "s" : ""}</strong> : {formatFcfa(k.anomalyAmount)} encaissés sans activer l&apos;abonnement. À vérifier dans FedaPay.</p>
          <Button variant="secondary" onClick={onOpenIssues}>Voir les paiements</Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi testId="kpi-month" label="Encaissé ce mois" value={formatFcfa(k.collectedMonth)} hint={tr.text} tone={tr.tone === "down" ? "warning" : undefined} />
        <Kpi testId="kpi-mrr" label="MRR (revenu mensuel récurrent)" value={formatFcfa(k.mrr)} hint={k.mrrPrevious ? `${k.mrr >= k.mrrPrevious ? "+" : ""}${Math.round(((k.mrr - k.mrrPrevious) / k.mrrPrevious) * 100)} % vs fin du mois précédent` : "Abonnements payants en cours"} />
        <Kpi testId="kpi-total" label="Encaissé depuis le début" value={formatFcfa(k.collectedTotal)} hint={`dont remboursé : ${formatFcfa(k.refundedTotal)}`} />
        <Kpi testId="kpi-rate" label="Taux de réussite (30 jours)" value={k.successRate30 === null ? "—" : `${k.successRate30} %`} hint={`${k.success30} réussi${k.success30 > 1 ? "s" : ""} · ${k.failed30 + k.incomplete30} non abouti${k.failed30 + k.incomplete30 > 1 ? "s" : ""}`} tone={k.successRate30 !== null && k.successRate30 < 70 ? "warning" : undefined} />
        <Kpi testId="kpi-failed" label="Paiements non aboutis (30 jours)" value={String(issuesCount)} hint={issuesCount ? `${formatFcfa(k.failedAmount30)} refusés` : "Rien à signaler"} tone={issuesCount ? "danger" : "success"} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Évolution des recettes nettes</CardTitle>
            <div className="flex gap-1.5" role="group" aria-label="Période">
              {RANGES.map((r) => <Button key={r} variant={months === r ? "primary" : "secondary"} onClick={() => setMonths(r)}>{r} mois</Button>)}
            </div>
          </div>
          <p className="text-body-sm text-ink-muted">{formatFcfa(periodTotal)} nets sur {data.months} mois · {periodCount} paiement{periodCount > 1 ? "s" : ""}. Net = encaissé moins remboursé (retiré du mois où le remboursement est versé). Le ✕ rouge indique les paiements non aboutis du mois.</p>
        </CardHeader>
        <CardContent>
          <MonthlyBars series={data.series} segments={NET_SEGMENT} value={(m) => m.net} testId="stats-bars" marker={(m) => (m.failed ? `✕${m.failed}` : null)}
            tip={(m) => `${monthLabel(m.month)} : ${formatFcfa(m.net)} net (encaissé ${formatFcfa(m.amount)}, remboursé ${formatFcfa(m.refunded)}) · ${m.payments} paiement${m.payments > 1 ? "s" : ""}${m.failed ? ` · ${m.failed} non abouti${m.failed > 1 ? "s" : ""}` : ""}`} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ce mois contre le mois précédent</CardTitle>
            <p className="text-body-sm text-ink-muted">Recettes cumulées jour par jour : le mois en cours est comparé au mois précédent à la même date.</p>
          </CardHeader>
          <CardContent><CumulLines daily={data.daily} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Revenu mensuel récurrent (MRR)</CardTitle>
            <p className="text-body-sm text-ink-muted">Chaque abonnement payant compte pour son prix divisé par sa durée : un paiement de 12 mois ne gonfle plus un seul mois.</p>
          </CardHeader>
          <CardContent>
            <MonthlyBars series={data.series} segments={[{ key: "mrr", label: "MRR", className: "bg-info-fg" }]} value={(m) => m.mrr} testId="stats-mrr"
              tip={(m) => `${monthLabel(m.month)} : ${formatFcfa(m.mrr)} par mois`} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recettes par offre, mois par mois</CardTitle></CardHeader>
          <CardContent>
            <MonthlyBars series={data.series} segments={PLAN_SEGMENTS} value={(m, k) => m.byPlan[k as keyof typeof m.byPlan]} testId="stats-stack-plan"
              tip={(m) => `${monthLabel(m.month)} : ${PLAN_SEGMENTS.map((g) => `${g.label} ${formatFcfa(m.byPlan[g.key as keyof typeof m.byPlan])}`).join(" · ")}`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Nouveaux clients et renouvellements</CardTitle></CardHeader>
          <CardContent>
            <MonthlyBars series={data.series} segments={KIND_SEGMENTS} value={(m, k) => m.byKind[k as keyof typeof m.byKind]} testId="stats-stack-kind"
              tip={(m) => `${monthLabel(m.month)} : ${KIND_SEGMENTS.map((g) => `${g.label} ${formatFcfa(m.byKind[g.key as keyof typeof m.byKind])}`).join(" · ")}`} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Entreprises</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ["Total", data.tenants.total],
                ["Nouvelles ce mois", data.tenants.newThisMonth],
                ["Abonnées", data.tenants.paying],
                ["Partenaires", data.tenants.partners],
                ["Internes", data.tenants.internal],
                ["Expirées", data.tenants.expired],
              ].map(([l, v]) => (
                <div key={l as string}><p className="font-display text-headline-sm text-ink">{v}</p><p className="text-body-xs text-ink-muted">{l}</p></div>
              ))}
            </div>
            {data.tenants.expiring14 > 0 && <Badge variant="warning">{data.tenants.expiring14} abonnement{data.tenants.expiring14 > 1 ? "s" : ""} se termine{data.tenants.expiring14 > 1 ? "nt" : ""} sous 14 jours</Badge>}
            <Distribution total={Math.max(1, ...data.plans.map((p) => p.count))} rows={data.plans.map((p) => ({ label: PLAN_LABEL[p.planKey] ?? p.planKey, value: p.count, extra: `${p.count} entreprise${p.count > 1 ? "s" : ""}` }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recettes par offre ({data.months} mois)</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Distribution total={Math.max(1, ...data.byPlan.map((p) => p.amount))} rows={data.byPlan.map((p) => ({ label: PLAN_LABEL[p.planKey] ?? p.planKey, value: p.amount, extra: `${formatFcfa(p.amount)} · ${p.payments}` }))} />
            <div>
              <p className="mb-2 font-label-md text-ink">Type de paiement</p>
              <Distribution total={Math.max(1, ...data.byKind.map((p) => p.amount))} rows={data.byKind.map((p) => ({ label: KIND_LABEL[p.kind] ?? p.kind, value: p.amount, extra: `${formatFcfa(p.amount)} · ${p.payments}` }))} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Pourquoi les paiements échouent (30 jours)</CardTitle></CardHeader>
          <CardContent>
            {data.failureReasons.length === 0 ? <p className="text-body-sm text-ink-muted">Aucun paiement non abouti.</p> : (
              <Distribution total={Math.max(1, ...data.failureReasons.map((r) => r.count))} rows={data.failureReasons.map((r) => ({ label: REASON_LABEL[r.reason] ?? REASON_LABEL.unknown, value: r.count, extra: String(r.count) }))} />
            )}
            {issuesCount > 0 && <Button variant="secondary" className="mt-4" onClick={onOpenIssues}>Voir le détail</Button>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Derniers paiements</CardTitle></CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {data.recent.length === 0 && <p className="text-body-sm text-ink-muted">Aucun paiement pour le moment.</p>}
            {data.recent.map((r) => {
              const b = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending;
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-medium text-ink">{r.companyName}</p>
                    <p className="text-body-xs text-ink-muted">{PLAN_LABEL[r.planKey] ?? r.planKey} · {r.months} mois · {formatDateLabel((r.paidAt ?? r.createdAt).slice(0, 10))}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-body-sm text-ink">{formatFcfa(r.amount)}</span>
                    <Badge variant={b.variant}>{b.label}</Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
