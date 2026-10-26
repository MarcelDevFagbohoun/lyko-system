"use client";

import * as React from "react";
import { cn, formatFcfa } from "@/lib/utils";

export type LedgerTone = "default" | "info" | "success" | "warning" | "danger";
export type LedgerRow = {
  label: string;
  /** Précision discrète sous le libellé. */
  hint?: string;
  amount: number;
  tone?: LedgerTone;
  /** Montant de référence de la barre (100 %) ; sinon le plus grand montant du tableau. */
  of?: number;
  /** Ligne de total : fond teinté, trait plus marqué. */
  total?: boolean;
  /**
   * Sens de lecture du pourcentage : « up » = plus c'est haut, mieux c'est (encaissé, réglé) ;
   * « down » = plus c'est bas, mieux c'est (impayés, reste à charge) ; « neutral » = pas de jugement.
   * Par défaut déduit de la teinte : succès/info → up, alerte/danger → down, sinon neutral.
   */
  polarity?: "up" | "down" | "neutral";
};

type Level = { label: string; pill: string; dot: string } | null;
const LEVELS = {
  low: { label: "Faible", pill: "border-danger-border bg-danger-bg text-danger-fg", dot: "bg-danger-strong" },
  normal: { label: "Normal", pill: "border-warning-border bg-warning-bg text-warning-fg", dot: "bg-warning-strong" },
  excellent: { label: "Excellent", pill: "border-success-border bg-success-bg text-success-fg", dot: "bg-success-strong" },
} as const;

/** Niveau d'un pourcentage : faible (rouge), normal (jaune), excellent (vert). Seuils : 50 % et 90 % (inversés si « down »). */
export function percentLevel(pct: number, polarity: "up" | "down" | "neutral"): Level {
  if (polarity === "neutral") return null;
  const score = polarity === "up" ? pct : 100 - pct;
  if (score >= 90) return LEVELS.excellent;
  if (score >= 50) return LEVELS.normal;
  return LEVELS.low;
}

const TEXT: Record<LedgerTone, string> = {
  default: "text-ink",
  info: "text-info-fg",
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
};

/** Montant qui « monte » jusqu'à sa valeur (coupé si l'utilisateur a demandé moins d'animations). */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = React.useState(value);
  React.useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{formatFcfa(shown)}</>;
}

/** Pourcentage qui « monte » jusqu'à sa valeur. */
function CountPercent({ value }: { value: number }) {
  const [shown, setShown] = React.useState(value);
  React.useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown} %</>;
}

/**
 * Tableau des charges SONEB/SBEE : en-tête bleu, lignes blanches à fins filets, montants qui montent à
 * l'affichage et, par ligne, la part du montant de référence en pourcentage coloré (faible rouge, normal jaune,
 * excellent vert) à la place de l'ancienne jauge.
 */
export function ChargeLedgerTable({ rows, caption }: { rows: LedgerRow[]; caption?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.of ?? Math.abs(r.amount)));
  return (
    <div className="overflow-x-auto rounded-lg border border-border-strong bg-surface">
      <table className="w-full border-collapse text-body-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="bg-primary text-white">
            <th className="px-3 py-2 text-left font-label-md">Désignation</th>
            <th className="px-3 py-2 text-center font-label-md">Part</th>
            <th className="px-3 py-2 text-right font-label-md">Montant</th>
          </tr>
        </thead>
        <tbody className="stagger">
          {rows.map((r) => {
            const tone = r.tone ?? "default";
            const ref = r.of ?? max;
            const pct = ref > 0 ? Math.min(100, Math.round((Math.abs(r.amount) / ref) * 100)) : 0;
            const polarity = r.polarity ?? (tone === "success" || tone === "info" ? "up" : tone === "warning" || tone === "danger" ? "down" : "neutral");
            const level = percentLevel(pct, polarity);
            return (
              <tr key={r.label} className={cn("border-t border-border-strong transition-colors hover:bg-primary-bg", r.total && "bg-surface-muted")}>
                <td className="px-3 py-2.5">
                  <span className={cn("text-ink", r.total && "font-label-md")}>{r.label}</span>
                  {r.hint && <span className="block text-body-xs text-ink-muted">{r.hint}</span>}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span
                    className={cn(
                      "tabular inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-label-md",
                      level ? level.pill : "border-border bg-surface-muted text-ink-soft",
                    )}
                    title={level ? `${pct} % — ${level.label}` : `${pct} %`}
                  >
                    {level && <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", level.dot)} />}
                    <CountPercent value={pct} />
                    {level && <span className="hidden text-body-xs font-medium sm:inline">{level.label}</span>}
                  </span>
                </td>
                <td className={cn("tabular whitespace-nowrap px-3 py-2.5 text-right font-currency-table", TEXT[tone], r.total && "font-label-md")}>
                  <CountUp value={r.amount} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
