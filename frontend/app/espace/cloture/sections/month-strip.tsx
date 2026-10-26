"use client";

import * as React from "react";
import {
  Lock,
  LockOpen,
  Clock,
  Check,
  Minus,
} from "lucide-react";
import { type ClosingMonthStatus, type ClosingOverview } from "@/lib/api/accounting";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatDateLabel, monthLabelFr } from "@/lib/utils";
import { MONTHS_SHORT, capitalize } from "./shared";

export const STATUS_LABEL: Record<ClosingMonthStatus, string> = {
  cloture: "Clôturé",
  pret: "Prêt à clôturer",
  en_attente: "En attente des échéances",
  en_cours: "Mois en cours",
  a_suivre: "À clôturer ensuite",
  hors_suivi: "Avant le démarrage",
};

export const STATUS_CELL: Record<ClosingMonthStatus, string> = {
  cloture: "bg-ink-muted/80 text-white border-transparent",
  pret: "bg-success text-white border-transparent",
  en_attente: "bg-warning text-white border-transparent",
  en_cours: "bg-primary-bg text-primary border-primary/40",
  a_suivre: "bg-surface text-ink-muted border-border-strong border-dashed",
  hors_suivi: "bg-surface-muted text-ink-faint border-transparent",
};

export function StatusIcon({ status }: { status: ClosingMonthStatus }) {
  const size = 14;
  // Étape 55 (partie Clôture) : le cadenas d'un mois clôturé se referme d'un coup sec.
  if (status === "cloture") return <Lock size={size} aria-hidden className="animate-lock-snap" />;
  if (status === "pret") return <Check size={size} strokeWidth={3} aria-hidden />;
  if (status === "en_attente") return <Clock size={size} aria-hidden />;
  if (status === "en_cours") return <LockOpen size={size} aria-hidden />;
  return <Minus size={size} aria-hidden />;
}

export const LEGEND: ClosingMonthStatus[] = ["cloture", "pret", "en_attente", "a_suivre", "en_cours"];

export function MonthStrip({ months: allMonths }: { months: ClosingOverview["months"] }) {
  // Les mois antérieurs au démarrage n'apportent rien : un seul est gardé, comme repère.
  const firstTracked = allMonths.findIndex((m) => m.status !== "hors_suivi");
  const months = firstTracked > 1 ? allMonths.slice(firstTracked - 1) : allMonths;
  const legend = months.some((m) => m.status === "hors_suivi") ? [...LEGEND, "hors_suivi" as const] : LEGEND;
  const stripRef = React.useRef<HTMLDivElement>(null);
  // Les mois récents (à droite) sont ceux qui comptent : la frise démarre défilée à la fin.
  React.useEffect(() => {
    if (stripRef.current) stripRef.current.scrollLeft = stripRef.current.scrollWidth;
  }, [months]);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <p className="font-label-sm uppercase tracking-wider text-ink-muted">Où en sont vos mois</p>
        <div ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-1" role="list" aria-label="État de clôture des mois">
          {months.map((m, i) => {
            const monthIndex = Number(m.month.slice(5, 7)) - 1;
            const detail =
              m.status === "en_attente" && m.closableFrom
                ? `${STATUS_LABEL[m.status]} — clôturable à partir du ${formatDateLabel(m.closableFrom)}`
                : STATUS_LABEL[m.status] + (m.forced ? " (clôture anticipée)" : "");
            return (
              <div
                key={m.month}
                role="listitem"
                title={`${capitalize(monthLabelFr(m.month))} — ${detail}`}
                className="flex min-w-[3rem] flex-1 flex-col items-center gap-1"
              >
                <span
                  className={cn(
                    "relative flex h-8 w-8 animate-cell-pop items-center justify-center rounded-md border",
                    STATUS_CELL[m.status],
                  )}
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  {/* Le mois prêt à clôturer appelle l'attention : une onde douce autour de sa case. */}
                  {m.status === "pret" && (
                    <span aria-hidden className="absolute inset-0 animate-ripple rounded-md border-2 border-success" />
                  )}
                  <StatusIcon status={m.status} />
                </span>
                <span
                  className={cn(
                    "text-body-xs",
                    m.status === "pret" || m.status === "en_attente" ? "font-label-md text-ink" : "text-ink-muted",
                  )}
                >
                  {MONTHS_SHORT[monthIndex]}
                </span>
                <span className="text-[10px] leading-none text-ink-faint">{m.month.slice(0, 4)}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-xs text-ink-muted">
          {legend.map((st) => (
            <span key={st} className="inline-flex items-center gap-1.5">
              <span className={cn("flex h-4 w-4 items-center justify-center rounded border", STATUS_CELL[st])}>
                <StatusIcon status={st} />
              </span>
              {STATUS_LABEL[st]}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Prochain mois à clôturer (points 1, 3, 4) ─────────────────────────────────────────────────

