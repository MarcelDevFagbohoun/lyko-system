"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { groupByMonth, type MonthGroup } from "@/lib/group-by-month";
import { monthLabelFr, cn } from "@/lib/utils";
import { TableCell, TableRow } from "@/components/ui/table";

/**
 * État de regroupement par mois d'une liste : jusqu'à 3 mois tout est déplié ;
 * au-delà, seuls le mois le plus récent et le mois en cours le sont (une longue
 * liste reste lisible), et un clic sur l'en-tête d'un mois le bascule. Le
 * choix de l'utilisateur est conservé quand la liste se recharge.
 *
 * `getMonth` doit être stable (fonction de module) pour ne pas recalculer le
 * regroupement à chaque rendu.
 */
export function useMonthGroups<T>(items: readonly T[] | null, getMonth: (item: T) => string | null | undefined) {
  const groups = React.useMemo<MonthGroup<T>[]>(() => (items ? groupByMonth(items, getMonth) : []), [items, getMonth]);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});

  // Liste courte (3 mois ou moins) : tout est ouvert, rien à chercher. Au-delà : le mois le plus récent
  // et le mois en cours seulement, les plus anciens restent repliés.
  const defaultOpen = (month: string, index: number) => groups.length <= 3 || index === 0 || month === currentMonth;
  const isOpen = (month: string, index: number) => overrides[month] ?? defaultOpen(month, index);
  const toggle = (month: string, index: number) =>
    setOverrides((o) => ({ ...o, [month]: !(o[month] ?? defaultOpen(month, index)) }));
  const setAll = (open: boolean) => setOverrides(Object.fromEntries(groups.map((g) => [g.month, open])));
  const allOpen = groups.length > 0 && groups.every((g, i) => isOpen(g.month, i));

  return { groups, isOpen, toggle, setAll, allOpen };
}

/** « Tout déplier / Tout replier » — seulement utile à partir de deux mois. */
export function MonthGroupsToolbar({
  count,
  allOpen,
  onSetAll,
}: {
  count: number;
  allOpen: boolean;
  onSetAll: (open: boolean) => void;
}) {
  if (count < 2) return null;
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={() => onSetAll(!allOpen)}
        className="font-label-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {allOpen ? "Tout replier" : "Tout déplier"}
      </button>
    </div>
  );
}

/**
 * Ligne d'en-tête d'un mois, à placer en premier dans un `<TableBody>` (un
 * `<TableBody>` par mois : les rayures zébrées repartent ainsi à chaque mois).
 * `summary` = le bilan du mois (à droite), `badge` = son état (payé, partiel…).
 */
export function MonthHeaderRow({
  colSpan,
  month,
  open,
  onToggle,
  summary,
  badge,
  noun,
}: {
  colSpan: number;
  month: string;
  open: boolean;
  onToggle: () => void;
  summary: React.ReactNode;
  badge?: React.ReactNode;
  /** Ex. « Loyer » → « Loyer de septembre 2026 » / « Loyer d'août 2026 ». Sans `noun` : le nom du mois seul. */
  noun?: string;
}) {
  const label = month ? monthLabelFr(month) : "Sans date";
  const title = noun ? `${noun} ${month && /^[aeiou]/i.test(label) ? "d'" : "de "}${label}` : label;
  return (
    <TableRow className="bg-primary-bg/60 hover:bg-primary-bg">
      <TableCell colSpan={colSpan} className="!p-0">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <ChevronRight size={16} className={cn("shrink-0 text-primary transition-transform", open && "rotate-90")} />
            <span className={cn("font-label-md text-ink", !noun && "capitalize")}>{title}</span>
            {badge}
          </span>
          <span className="shrink-0 text-right text-body-xs text-ink-soft">{summary}</span>
        </button>
      </TableCell>
    </TableRow>
  );
}

/** « 3 paiements · 300 000 FCFA » : bilan par défaut d'un mois. */
export function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count > 1 ? plural : singular}`;
}
