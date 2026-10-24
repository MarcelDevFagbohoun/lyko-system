"use client";

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

/**
 * Tableau des charges SONEB/SBEE, version compacte : une ligne par chiffre (libellé + montant), sans jauge.
 * `hint` et `of` restent acceptés pour compatibilité mais ne sont plus affichés.
 */
export function ChargeLedgerTable({ rows, caption }: { rows: LedgerRow[]; caption?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-strong bg-surface">
      <table className="w-full border-collapse text-body-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <tbody>
          {rows.map((r) => {
            const tone = r.tone ?? "default";
            return (
              <tr key={r.label} className={cn("border-t border-border first:border-t-0", r.total && "bg-surface-muted")}>
                <td className={cn("px-3 py-1.5 text-ink", r.total && "font-label-md")}>{r.label}</td>
                <td className={cn("tabular whitespace-nowrap px-3 py-1.5 text-right font-currency-table", TEXT[tone], r.total && "font-label-md")}>
                  {formatFcfa(r.amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
