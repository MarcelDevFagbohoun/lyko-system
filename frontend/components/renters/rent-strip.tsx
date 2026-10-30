"use client";

import * as React from "react";
import { AlertTriangle, Check, CircleDashed, Clock, Minus } from "lucide-react";
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
      return "Avant le début du suivi dans Africa Immo Management : rien n'est réclamé pour ce mois.";
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

/**
 * Case d'un mois. Partiel : remplie au prorata de ce qui est payé, comme une jauge.
 * Étape 55 (partie Locataires) : les cases apparaissent l'une après l'autre (`index`) et la jauge
 * d'un mois partiel se remplit depuis le bas — la frise « se construit » sous les yeux.
 */
function Cell({ m, size, late, index = 0 }: { m: RentStripMonth; size: number; late: boolean; index?: number }) {
  const ratio = m.due > 0 ? Math.min(1, m.paid / m.due) : 0;
  return (
    <span
      className={cn(
        "relative flex shrink-0 animate-cell-pop items-center justify-center overflow-hidden rounded",
        CELL[m.status],
        // Partiel ET échéance dépassée : contour rouge, la jauge orange dit ce qui est payé.
        m.status === "partiel" && late && "border-danger-strong",
      )}
      style={{ width: size, height: size, animationDelay: `${index * 35}ms` }}
    >
      {m.status === "partiel" && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 origin-bottom animate-gauge-fill bg-warning"
          style={{ height: `${Math.round(ratio * 100)}%`, animationDelay: `${index * 35 + 200}ms` }}
        />
      )}
      <span className="relative flex items-center justify-center">
        <StatusIcon status={m.status} size={Math.max(8, Math.round(size * 0.55))} />
      </span>
    </span>
  );
}

/** Présentation d'un mois dans la frise « complète » : pastille douce + petite jauge, jamais de gros aplats. */
const TILE_STYLE: Record<RentStripStatus, { disc: string; bar: string; tile: string }> = {
  paye: { disc: "bg-success-bg text-success-fg ring-1 ring-success-border", bar: "bg-success-strong", tile: "border-border" },
  partiel: { disc: "bg-warning-bg text-warning-fg ring-1 ring-warning-border", bar: "bg-warning-strong", tile: "border-border" },
  en_retard: { disc: "bg-danger-bg text-danger-fg ring-1 ring-danger-border", bar: "bg-danger-strong", tile: "border-danger-border bg-danger-bg/30" },
  a_payer: { disc: "bg-primary-bg text-primary ring-1 ring-primary-border", bar: "bg-primary", tile: "border-primary-border" },
  a_venir: { disc: "border border-dashed border-border-strong text-ink-faint", bar: "bg-border-strong", tile: "border-border" },
  avant_suivi: { disc: "bg-surface-muted text-ink-faint", bar: "bg-border", tile: "border-border-subtle opacity-70" },
  hors_bail: { disc: "text-border-strong", bar: "bg-border", tile: "border-transparent opacity-50" },
};

function Disc({ m, size }: { m: RentStripMonth; size: number }) {
  const pct = m.due > 0 ? Math.min(100, Math.round((m.paid / m.due) * 100)) : 0;
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full", TILE_STYLE[m.status].disc)} style={{ width: size, height: size }}>
      {m.status === "partiel" ? (
        <span className="text-[10px] font-semibold leading-none" aria-hidden>{pct}%</span>
      ) : m.status === "a_venir" ? (
        <CircleDashed size={Math.round(size * 0.5)} aria-hidden />
      ) : (
        <StatusIcon status={m.status} size={Math.round(size * 0.5)} />
      )}
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
 *  - `full`    : une tuile par mois (nom, pastille d'état, jauge), un résumé chiffré, un panneau de détail
 *                au clic (le mois en cours par défaut) et une légende.
 */
export function RentStrip({ months, variant = "full" }: { months: RentStripMonth[] | null | undefined; variant?: "compact" | "full" }) {
  const current = months?.find((m) => m.isCurrent)?.month ?? null;
  const [selected, setSelected] = React.useState<string | null>(null);

  if (!months || months.length === 0) return null;

  if (variant === "compact") {
    return (
      <span className="inline-flex items-center gap-1" role="img" aria-label="Frise des 12 mois de loyer">
        {months.map((m, i) => (
          <span key={m.month} title={`${monthLabelFr(m.month)} — ${describeStripMonth(m)}`}>
            <Cell m={m} size={14} late={m.late} index={i} />
          </span>
        ))}
      </span>
    );
  }

  const active = months.find((m) => m.month === (selected ?? current)) ?? months[0];
  const count = (st: RentStripStatus) => months.filter((m) => m.status === st).length;
  const summary = [
    { st: "paye" as const, n: count("paye"), label: "payé(s)", cls: "bg-success-bg text-success-fg" },
    { st: "partiel" as const, n: count("partiel"), label: "partiel(s)", cls: "bg-warning-bg text-warning-fg" },
    { st: "en_retard" as const, n: count("en_retard"), label: "en retard", cls: "bg-danger-bg text-danger-fg" },
  ].filter((x) => x.n > 0);

  return (
    <div className="flex flex-col gap-4">
      {summary.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Résumé des 12 mois">
          {summary.map((x) => (
            <span key={x.st} className={cn("rounded-full px-2.5 py-0.5 text-body-xs font-medium", x.cls)}>{x.n} {x.label}</span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12" role="group" aria-label="Frise des 12 mois de loyer">
        {months.map((m) => {
          const isActive = m.month === active.month;
          const monthIndex = Number(m.month.slice(5, 7)) - 1;
          // Période non-calendaire (clé « AAAA-MM-JJ », étape 2c) : le jour de début précède le mois.
          const startDay = m.month.length === 10 ? `${Number(m.month.slice(8, 10))} ` : "";
          const ratio = m.status === "paye" || m.status === "en_retard" ? 100 : m.due > 0 ? Math.min(100, Math.round((m.paid / m.due) * 100)) : 0;
          const st = TILE_STYLE[m.status];
          return (
            <button
              key={m.month}
              type="button"
              onClick={() => setSelected(m.month)}
              aria-pressed={isActive}
              title={`${monthLabelFr(m.month)} — ${describeStripMonth(m)}`}
              className={cn(
                "relative flex flex-col items-center gap-1.5 rounded-xl border bg-surface px-1 pb-2 pt-2.5 shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                st.tile,
                isActive ? "-translate-y-0.5 shadow-md ring-2 ring-primary" : "hover:-translate-y-0.5 hover:shadow-md",
              )}
            >
              {m.isCurrent && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" aria-label="Mois en cours" />}
              <span className={cn("text-[11px] font-semibold uppercase tracking-wide", m.isCurrent ? "text-primary" : "text-ink-soft")}>
                {startDay}{MONTHS_SHORT[monthIndex]}
              </span>
              <Disc m={m} size={30} />
              <span className="text-[10px] leading-none text-ink-faint">{m.month.slice(0, 4)}</span>
              <span className="mt-0.5 h-1 w-[70%] overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                <span className={cn("block h-full rounded-full", st.bar)} style={{ width: `${ratio}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={cn("flex items-start gap-3 rounded-xl border border-l-4 bg-surface p-3 shadow-sm", TILE_STYLE[active.status].tile, active.status === "en_retard" ? "border-l-danger-strong" : active.status === "paye" ? "border-l-success-strong" : active.status === "partiel" ? "border-l-warning-strong" : active.status === "a_payer" ? "border-l-primary" : "border-l-border-strong")}
        aria-live="polite"
      >
        <Disc m={active} size={36} />
        <div className="min-w-0">
          <p className="font-label-md capitalize text-ink">
            {monthLabelFr(active.month)} <span className="ml-1 text-body-xs font-normal normal-case text-ink-muted">· {STATUS_LABEL[active.status]}</span>
          </p>
          <p className="text-body-sm text-ink-soft">{describeStripMonth(active)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-body-xs text-ink-muted">
        {LEGEND.map((st) => (
          <span key={st} className="inline-flex items-center gap-1.5">
            <Disc m={{ month: "", status: st, paid: st === "partiel" ? 1 : 0, due: 2, remaining: 0, dueDate: "", late: false, isCurrent: false }} size={16} />
            {STATUS_LABEL[st]}
          </span>
        ))}
      </div>
    </div>
  );
}
