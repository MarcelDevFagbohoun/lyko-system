"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { getRentMonthSummary, type RentMonthSummary } from "@/lib/api/accounting";
import { formatFcfa, monthLabelFr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedBar } from "@/components/ui/segmented-bar";

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * « Ce mois-ci » : où en sont les loyers d'un mois d'un coup d'œil — attendu,
 * encaissé, reste à encaisser, et parmi le reste ce qui est déjà en retard.
 * Suit le mois choisi dans la page ; « Ce mois-ci » s'affiche quand c'est le
 * mois en cours. Même règle par bail que la frise des 12 mois du locataire.
 */
export function RentMonthCard({ yearMonth }: { yearMonth: string }) {
  const { accessToken } = useAuth();
  const [data, setData] = React.useState<RentMonthSummary | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) return;
    let cancelled = false;
    setFailed(false);
    getRentMonthSummary(accessToken, yearMonth)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, yearMonth]);

  if (failed || !data || data.month !== yearMonth) return null;

  const { expected, collected, remaining, lateRemaining, upcomingRemaining, counts } = data;
  const pct = expected > 0 ? Math.round((collected / expected) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays size={18} className="text-primary" />
            Loyers <span className="capitalize">{monthLabelFr(data.month)}</span>
          </CardTitle>
          {data.isCurrentMonth && <Badge variant="primary">Ce mois-ci</Badge>}
        </div>
        <CardDescription>Loyer attendu selon les baux suivis ce mois-là, et ce qui est déjà encaissé.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {counts.leases === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucun bail suivi pour ce mois.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Figure label="Attendu" value={formatFcfa(expected)} sub={plural(counts.leases, "bail suivi", "baux suivis")} />
              <Figure label="Encaissé" value={formatFcfa(collected)} sub={`${pct} % de l'attendu`} tone="success" />
              <Figure
                label="Reste à encaisser"
                value={formatFcfa(remaining)}
                sub={lateRemaining > 0 ? `dont ${formatFcfa(lateRemaining)} en retard` : remaining > 0 ? "pas encore dû" : "tout est encaissé"}
                tone={lateRemaining > 0 ? "danger" : remaining > 0 ? "muted" : "success"}
              />
            </div>

            <SegmentedBar
              ariaLabel={`${pct} % encaissé : ${formatFcfa(collected)} sur ${formatFcfa(expected)} attendus, dont ${formatFcfa(lateRemaining)} en retard`}
              segments={[
                { value: collected, className: "bg-success-strong", label: "Encaissé" },
                { value: lateRemaining, className: "bg-danger-strong", label: "En retard" },
                { value: upcomingRemaining, className: "bg-border-strong", label: "Pas encore dû" },
              ]}
            />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-xs text-ink-muted">
              <Legend className="bg-success-strong" label="Encaissé" />
              <Legend className="bg-danger-strong" label="En retard" />
              <Legend className="bg-border-strong" label="Pas encore dû" />
              <span className="ml-auto text-ink-soft">
                {[
                  counts.paye > 0 && plural(counts.paye, "payé", "payés"),
                  counts.partiel > 0 && plural(counts.partiel, "partiel", "partiels"),
                  counts.en_retard > 0 && `${counts.en_retard} en retard`,
                  counts.a_payer + counts.a_venir > 0 && `${counts.a_payer + counts.a_venir} à venir`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>

            {counts.late > 0 && (
              <Link href="/espace/relances" className="inline-flex w-fit items-center gap-1.5 font-label-sm text-primary hover:underline">
                Voir les {plural(counts.late, "bail", "baux")} en retard
                <ArrowRight size={14} />
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "success" | "danger" | "muted" }) {
  const color = tone === "success" ? "text-success-fg" : tone === "danger" ? "text-danger-fg" : "text-ink";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">{label}</span>
      <span className={`tabular font-display text-headline-md ${color}`}>{value}</span>
      {sub && <span className="text-body-xs text-ink-muted">{sub}</span>}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}
