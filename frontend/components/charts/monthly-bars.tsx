import * as React from "react";
import { compact, monthLabel } from "@/lib/chart-utils";
import { formatFcfa } from "@/lib/utils";

export type ChartSegment = { key: string; label: string; className: string };

/**
 * Histogramme mensuel en CSS (barres empilées si plusieurs segments) : s'adapte à la largeur, défile horizontalement au-delà
 * de 12 mois sur petit écran. `marker` ajoute une petite étiquette rouge sous le mois (ex. paiements non aboutis).
 * `unit` formate les valeurs : FCFA par défaut, « % » pour un taux.
 */
export function MonthlyBars<T extends { month: string }>({ series, segments, value, tip, testId, marker, unit = "fcfa", grouped = false }: {
  series: T[];
  segments: ChartSegment[];
  value: (s: T, key: string) => number;
  tip: (s: T) => string;
  testId: string;
  marker?: (s: T) => string | null;
  unit?: "fcfa" | "percent";
  /** Barres côte à côte (chacune sa propre hauteur) au lieu d'être empilées : pour comparer deux grandeurs qui ne s'additionnent pas. */
  grouped?: boolean;
}) {
  const total = (s: T) => segments.reduce((a, g) => a + value(s, g.key), 0);
  const max = unit === "percent" ? 100 : grouped ? Math.max(1, ...series.flatMap((s) => segments.map((g) => value(s, g.key)))) : Math.max(1, ...series.map(total));
  const wide = series.length > 12;
  const label = (n: number) => (unit === "percent" ? `${Math.round(n)}%` : compact(n));
  return (
    <div className="flex flex-col gap-3">
      {(segments.length > 1 || grouped) && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-xs text-ink-soft">
          {segments.map((g) => <li key={g.key} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${g.className}`} />{g.label}</li>)}
        </ul>
      )}
      <div className="overflow-x-auto" role="img" aria-label={series.map((s) => `${monthLabel(s.month)} ${unit === "percent" ? `${Math.round(total(s))} %` : formatFcfa(total(s))}`).join(", ")}>
        <div className={`flex h-56 items-end gap-1.5 sm:gap-2 ${wide ? "min-w-[34rem]" : ""}`} data-testid={testId}>
          {series.map((s) => {
            const mk = marker?.(s) ?? null;
            return (
              <div key={s.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={tip(s)}>
                {!grouped && <span className="whitespace-nowrap text-[9px] leading-none text-ink-muted sm:text-body-xs">{total(s) ? label(total(s)) : ""}</span>}
                {grouped ? (
                  <div className="flex w-full flex-1 items-end gap-0.5">
                    {segments.map((g) => {
                      const v = value(s, g.key);
                      return <div key={g.key} className={`w-full rounded-t ${g.className}`} style={{ height: v > 0 ? `${Math.max(2, (v / max) * 100)}%` : "0%" }} />;
                    })}
                  </div>
                ) : (
                  <div className="flex w-full flex-1 flex-col-reverse justify-start">
                    {segments.map((g) => {
                      const v = value(s, g.key);
                      return v > 0 ? <div key={g.key} className={`w-full first:rounded-b-none last:rounded-t ${g.className}`} style={{ height: `${Math.max(2, (v / max) * 100)}%` }} /> : null;
                    })}
                  </div>
                )}
                <span className="text-[10px] leading-none text-ink-soft sm:text-body-xs">{monthLabel(s.month).split(" ")[0]}</span>
                {marker && <span className={`text-[10px] leading-none ${mk ? "text-danger-fg" : "text-transparent"}`} aria-hidden>{mk ?? "·"}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
