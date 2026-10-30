"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PlanningTask } from "@/lib/api/planning";
import { STATUS_CHIP, PRIORITY_DOT, fmtDate, todayBenin } from "./planning-shared";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Jours couverts par une tâche : de son début à son échéance (62 jours max), sinon le seul jour d'échéance. */
function spanDays(t: PlanningTask): string[] {
  if (!t.dueDate) return [];
  if (!t.startDate || t.startDate >= t.dueDate) return [t.dueDate];
  const out: string[] = [];
  const cur = new Date(`${t.startDate}T00:00:00Z`);
  const end = new Date(`${t.dueDate}T00:00:00Z`);
  while (cur <= end && out.length < 62) { out.push(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
  return out;
}

export function CalendarView({ tasks, onOpen, onAdd }: { tasks: PlanningTask[]; onOpen: (t: PlanningTask) => void; onAdd: (date: string) => void }) {
  const today = todayBenin();
  const [y0, m0] = today.split("-").map(Number);
  const [cursor, setCursor] = React.useState({ y: y0, m: m0 - 1 });
  const [selected, setSelected] = React.useState(today);

  const byDay = React.useMemo(() => {
    const map = new Map<string, PlanningTask[]>();
    tasks.forEach((t) => spanDays(t).forEach((d) => map.set(d, [...(map.get(d) ?? []), t])));
    return map;
  }, [tasks]);

  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // semaine commençant le lundi
  const dim = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => ymd(cursor.y, cursor.m, i + 1))];
  while (cells.length % 7) cells.push(null);

  const title = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const step = (n: number) => setCursor(({ y, m }) => { const d = new Date(Date.UTC(y, m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const dayList = byDay.get(selected) ?? [];
  const noDate = tasks.filter((t) => !t.dueDate && t.status !== "termine");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => step(-1)} aria-label="Mois précédent" className="rounded-full p-2 hover:bg-surface-muted"><ChevronLeft size={18} /></button>
        <h3 className="min-w-[150px] text-center font-display text-lg font-semibold capitalize text-ink">{title}</h3>
        <button type="button" onClick={() => step(1)} aria-label="Mois suivant" className="rounded-full p-2 hover:bg-surface-muted"><ChevronRight size={18} /></button>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => { setCursor({ y: y0, m: m0 - 1 }); setSelected(today); }}>Aujourd&apos;hui</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-border bg-surface-muted text-center text-xs font-medium uppercase text-ink-muted">
          {DOW.map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="min-h-[52px] border-b border-r border-border/60 bg-surface-muted/40 sm:min-h-[96px]" />;
            const list = byDay.get(d) ?? [];
            const isToday = d === today;
            return (
              <div
                key={d}
                role="button"
                tabIndex={0}
                aria-label={`${fmtDate(d)}, ${list.length} tâche(s)`}
                onClick={() => setSelected(d)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelected(d)}
                className={cn("min-h-[52px] cursor-pointer border-b border-r border-border/60 p-1 text-left hover:bg-surface-muted/60 sm:min-h-[96px] sm:p-1.5", d === selected && "bg-primary/5 ring-1 ring-inset ring-primary")}
              >
                <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full text-xs", isToday ? "bg-primary font-semibold text-primary-fg" : "text-ink-soft")}>{Number(d.slice(8))}</span>
                {/* Mobile : points ; ordinateur : étiquettes */}
                <div className="mt-0.5 flex flex-wrap gap-0.5 sm:hidden">
                  {list.slice(0, 4).map((t) => <span key={t.id} className={cn("h-1.5 w-1.5 rounded-full", PRIORITY_DOT[t.priority])} />)}
                </div>
                <div className="mt-0.5 hidden flex-col gap-0.5 sm:flex">
                  {list.slice(0, 3).map((t) => (
                    <button key={t.id} type="button" onClick={(e) => { e.stopPropagation(); onOpen(t); }} className={cn("truncate rounded border px-1 py-0.5 text-left text-[11px] leading-tight", STATUS_CHIP[t.status])}>{t.title}</button>
                  ))}
                  {list.length > 3 && <span className="px-1 text-[11px] text-ink-muted">+{list.length - 3} autre(s)</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="font-label-md capitalize text-ink">{new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${selected}T00:00:00Z`))}</h4>
          <Button size="sm" variant="secondary" onClick={() => onAdd(selected)}><Plus size={14} /> Tâche ce jour</Button>
        </div>
        {dayList.length === 0 ? <p className="text-body-sm text-ink-muted">Aucune tâche ce jour-là.</p> : (
          <ul className="flex flex-col gap-1.5">
            {dayList.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onOpen(t)} className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left hover:bg-surface-muted">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", PRIORITY_DOT[t.priority])} />
                  <span className={cn("min-w-0 flex-1 truncate text-body-md", t.status === "termine" && "text-ink-muted line-through")}>{t.title}</span>
                  <span className={cn("shrink-0 rounded-full border px-2 text-xs", STATUS_CHIP[t.status].replace(" line-through opacity-80", ""))}>{t.status === "a_faire" ? "À faire" : t.status === "en_cours" ? "En cours" : "Terminé"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {noDate.length > 0 && (
        <div className="rounded-xl border border-dashed border-border p-3">
          <p className="mb-1.5 text-body-sm font-medium text-ink-soft">Sans date ({noDate.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {noDate.map((t) => <button key={t.id} type="button" onClick={() => onOpen(t)} className={cn("rounded border px-2 py-1 text-xs", STATUS_CHIP[t.status])}>{t.title}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
