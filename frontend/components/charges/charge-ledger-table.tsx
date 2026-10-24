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
};

const TEXT: Record<LedgerTone, string> = {
  default: "text-ink",
  info: "text-info-fg",
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
};
const BAR: Record<LedgerTone, string> = {
  default: "bg-primary",
  info: "bg-info",
  success: "bg-success-strong",
  warning: "bg-warning-strong",
  danger: "bg-danger-strong",
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

/**
 * Tableau des charges SONEB/SBEE : en-tête bleu, lignes blanches à fins filets, montants qui montent à
 * l'affichage et petite jauge animée par ligne (part du montant de référence). Remplace les cartes de chiffres.
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
            <th className="hidden w-[30%] px-3 py-2 text-left font-label-md sm:table-cell">Part</th>
            <th className="px-3 py-2 text-right font-label-md">Montant</th>
          </tr>
        </thead>
        <tbody className="stagger">
          {rows.map((r) => {
            const tone = r.tone ?? "default";
            const pct = Math.min(100, Math.round((Math.abs(r.amount) / (r.of ?? max)) * 100));
            return (
              <tr key={r.label} className={cn("border-t border-border-strong transition-colors hover:bg-primary-bg", r.total && "bg-surface-muted")}>
                <td className="px-3 py-2.5">
                  <span className={cn("text-ink", r.total && "font-label-md")}>{r.label}</span>
                  {r.hint && <span className="block text-body-xs text-ink-muted">{r.hint}</span>}
                </td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                    <div className="h-full origin-left animate-bar-grow rounded-full" style={{ width: `${pct}%` }}>
                      <div className={cn("h-full w-full rounded-full", BAR[tone])} />
                    </div>
                  </div>
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
