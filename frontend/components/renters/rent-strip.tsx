"use client";

import * as React from "react";
import { AlertTriangle, Check, Clock, Minus } from "lucide-react";
import type { RentStripMonth, RentStripStatus } from "@/lib/api/renters";
import { formatDateLabel, formatFcfa, monthLabelFr, cn } from "@/lib/utils";

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const STATUS_LABEL: Record<RentStripStatus, string> = {
  paye: "Payé",
  partiel: "Partiel",
  en_retard: "En retard",
  a_payer: "À payer",
  a_venir: "À venir",
  avant_suivi: "Avant le suivi",
  hors_bail: "Hors bail",
};

// Couleur ET forme/icône : la frise ne doit jamais reposer sur la couleur seule.
const CELL: Record<RentStripStatus, string> = {
  paye: "border-transparent bg-success-strong text-white",
  partiel: "border-warning-strong bg-warning-bg text-warning-fg",
  en_retard: "border-transparent bg-danger-strong text-white",
  a_payer: "border-2 border-primary bg-primary-bg text-primary",
  a_venir: "border border-dashed border-border-strong bg-transparent text-ink-faint",
  avant_suivi: "border-transparent bg-surface-muted text-ink-faint",
  hors_bail: "border-transparent bg-transparent text-border-strong",
};

const LEGEND: RentStripStatus[] = ["paye", "partiel", "en_retard", "a_payer", "a_venir"];

/** Une phrase qui dit tout sur un mois — utilisée en info-bulle et dans la ligne de détail. */
export function describeStripMonth(m: RentStripMonth): string {
  const due = formatDateLabel(m.dueDate);
  switch (m.status) {
    case "paye":
      return `Payé : ${formatFcfa(m.paid)} sur ${formatFcfa(m.due)}.`;
    case "partiel":
      return `Partiel : ${formatFcfa(m.paid)} payés sur ${formatFcfa(m.due)}, reste ${formatFcfa(m.remaining)} — ${
        m.late ? `échéance dépassée depuis le ${due}` : `échéance le ${due}`
      }.`;
    case "en_retard":
      return `En retard : rien de payé, ${formatFcfa(m.due)} dus depuis le ${due}.`;
    case "a_payer":
      return `À payer : ${formatFcfa(m.due)} avant le ${due}.`;
    case "a_venir":
      return `À venir : ${formatFcfa(m.due)} à payer avant le ${due}.`;
    case "avant_suivi":
      return "Avant le début du suivi dans Lyko System : rien n'est réclamé pour ce mois.";
    default:
      return "Hors bail.";
  }
}

function StatusIcon({ status, size }: { status: RentStripStatus; size: number }) {
  if (status === "paye") return <Check size={size} strokeWidth={3} aria-hidden />;
  if (status === "en_retard") return <AlertTriangle size={size} strokeWidth={2.5} aria-hidden />;
  if (status === "a_payer") return <Clock size={size} strokeWidth={2.5} aria-hidden />;
  if (status === "avant_suivi" || status === "hors_bail") return <Minus size={size} aria-hidden />;
  return null;
}

/** Case d'un mois. Partiel : remplie au prorata de ce qui est payé, comme une jauge. */
function Cell({ m, size, late }: { m: RentStripMonth; size: number; late: boolean }) {
  const ratio = m.due > 0 ? Math.min(1, m.paid / m.due) : 0;
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded",
        CELL[m.status],
        // Partiel ET échéance dépassée : contour rouge, la jauge orange dit ce qui est payé.
        m.status === "partiel" && late && "border-danger-strong",
      )}
      style={{ width: size, height: size }}
    >
      {m.status === "partiel" && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 bg-warning" style={{ height: `${Math.round(ratio * 100)}%` }} />
      )}
      <span className="relative flex items-center justify-center">
        <StatusIcon status={m.status} size={Math.max(8, Math.round(size * 0.55))} />
      </span>
    </span>
  );
}

/**
 * Frise des 12 mois d'un locataire : « est-il à jour ? » d'un coup d'œil, mois
 * par mois — payé, partiel (jauge), en retard, à payer, à venir. Les états
 * viennent du serveur (`buildRentStrip`), calculés avec la même règle que le
 * retard affiché ailleurs : une seule vérité.
 *
 *  - `compact` : petites pastilles pour une liste (info-bulle au survol).
 *  - `full`    : cases avec le nom du mois, légende, et une ligne de détail
 *                au clic (le mois en cours par défaut).
 */
export function RentStrip({ months, variant = "full" }: { months: RentStripMonth[] | null | undefined; variant?: "compact" | "full" }) {
  const current = months?.find((m) => m.isCurrent)?.month ?? null;
  const [selected, setSelected] = React.useState<string | null>(null);

  if (!months || months.length === 0) return null;

  if (variant === "compact") {
    return (
      <span className="inline-flex items-center gap-1" role="img" aria-label="Frise des 12 mois de loyer">
        {months.map((m) => (
          <span key={m.month} title={`${monthLabelFr(m.month)} — ${describeStripMonth(m)}`}>
            <Cell m={m} size={14} late={m.late} />
          </span>
        ))}
      </span>
    );
  }

  const active = months.find((m) => m.month === (selected ?? current)) ?? months[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Frise des 12 mois de loyer">
        {months.map((m) => {
          const isActive = m.month === active.month;
          const monthIndex = Number(m.month.slice(5, 7)) - 1;
          return (
            <button
              key={m.month}
              type="button"
              onClick={() => setSelected(m.month)}
              aria-pressed={isActive}
              title={`${monthLabelFr(m.month)} — ${describeStripMonth(m)}`}
              className={cn(
                "flex min-w-[2.75rem] flex-1 flex-col items-center gap-1 rounded-lg border px-1 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                isActive ? "border-primary bg-primary-bg/50" : "border-transparent hover:bg-surface-muted",
              )}
            >
              <Cell m={m} size={26} late={m.late} />
              <span className={cn("text-body-xs", m.isCurrent ? "font-label-md text-primary" : "text-ink-muted")}>
                {MONTHS_SHORT[monthIndex]}
              </span>
              <span className="text-[10px] leading-none text-ink-faint">{m.month.slice(0, 4)}</span>
            </button>
          );
        })}
      </div>

      <p className="rounded-lg bg-surface-muted px-3 py-2 text-body-sm text-ink-soft" aria-live="polite">
        <span className="font-label-md capitalize text-ink">{monthLabelFr(active.month)}</span> — {describeStripMonth(active)}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-xs text-ink-muted">
        {LEGEND.map((st) => (
          <span key={st} className="inline-flex items-center gap-1.5">
            <Cell
              m={{ month: "", status: st, paid: st === "partiel" ? 1 : 0, due: 2, remaining: 0, dueDate: "", late: false, isCurrent: false }}
              size={12}
              late={false}
            />
            {STATUS_LABEL[st]}
          </span>
        ))}
      </div>
    </div>
  );
}
