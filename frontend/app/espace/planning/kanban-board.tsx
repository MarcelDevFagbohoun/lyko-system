"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Flag, Target, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanningTask, TaskStatus } from "@/lib/api/planning";
import { STATUS_LABEL, PRIORITY_LABEL, fmtDate, isOverdue } from "./planning-shared";

const COLS: TaskStatus[] = ["a_faire", "en_cours", "termine"];
const HEAD: Record<TaskStatus, string> = { a_faire: "bg-slate-500", en_cours: "bg-amber-500", termine: "bg-emerald-500" };

/** Tableau Kanban : glisser-déposer sur ordinateur, flèches sur chaque carte (tactile). */
export function KanbanBoard({
  tasks, meId, onOpen, onMove, onAdd,
}: {
  tasks: PlanningTask[];
  meId: number;
  onOpen: (t: PlanningTask) => void;
  onMove: (t: PlanningTask, status: TaskStatus) => void;
  onAdd: () => void;
}) {
  const [over, setOver] = React.useState<TaskStatus | null>(null);
  const [mobileCol, setMobileCol] = React.useState<TaskStatus>("a_faire"); // téléphone : une colonne à la fois
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Colonnes" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1 md:hidden">
        {COLS.map((c) => (
          <button key={c} role="tab" aria-selected={mobileCol === c} type="button" onClick={() => setMobileCol(c)}
            className={cn("flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-body-sm font-medium", mobileCol === c ? "bg-surface text-ink shadow-sm" : "text-ink-soft")}>
            <span className={cn("h-2 w-2 rounded-full", HEAD[c])} />{STATUS_LABEL[c]}
            <span className="rounded-full bg-surface-muted px-1.5 text-xs">{tasks.filter((t) => t.status === c).length}</span>
          </button>
        ))}
      </div>
      <div className="md:grid md:grid-cols-3 md:gap-3">
      {COLS.map((col) => {
        const list = tasks.filter((t) => t.status === col);
        return (
          <section
            key={col}
            aria-label={STATUS_LABEL[col]}
            onDragOver={(e) => { e.preventDefault(); setOver(col); }}
            onDragLeave={() => setOver((o) => (o === col ? null : o))}
            onDrop={(e) => {
              e.preventDefault(); setOver(null);
              const t = tasks.find((x) => x.id === Number(e.dataTransfer.getData("text/plain")));
              if (t && t.status !== col) onMove(t, col);
            }}
            className={cn("min-h-[160px] flex-col rounded-xl bg-surface-muted/70 p-2.5 md:flex md:min-h-[200px]", mobileCol === col ? "flex" : "hidden", over === col && "ring-2 ring-primary/40")}
          >
            <header className="mb-2 flex items-center gap-2 px-1">
              <span className={cn("h-2.5 w-2.5 rounded-full", HEAD[col])} />
              <h3 className="font-label-md text-ink">{STATUS_LABEL[col]}</h3>
              <span className="rounded-full bg-surface px-2 text-xs text-ink-muted">{list.length}</span>
              {col === "a_faire" && <button type="button" onClick={onAdd} className="ml-auto rounded px-2 py-1 text-body-sm text-primary hover:bg-surface">+ Ajouter</button>}
            </header>
            <div className="flex flex-col gap-2">
              {list.length === 0 && (
                <p className="px-2 py-6 text-center text-body-sm text-ink-muted">
                  {col === "a_faire" ? "Aucune tâche à faire. Ajoutez-en une avec « + Ajouter »." : col === "en_cours" ? "Rien en cours. Faites avancer une tâche avec la flèche →." : "Aucune tâche terminée pour l'instant."}
                </p>
              )}
              {list.map((t) => {
                const idx = COLS.indexOf(t.status);
                const late = isOverdue(t.dueDate, t.status);
                return (
                  <article
                    key={t.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", String(t.id))}
                    className="cursor-grab rounded-lg border border-border bg-surface p-3 shadow-sm active:cursor-grabbing"
                  >
                    <button type="button" onClick={() => onOpen(t)} className="block w-full text-left">
                      <p className={cn("text-body-md font-medium text-ink", t.status === "termine" && "text-ink-muted line-through")}>{t.title}</p>
                      {t.description && <p className="mt-0.5 line-clamp-2 text-body-sm text-ink-muted">{t.description}</p>}
                    </button>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                      <span className="inline-flex items-center gap-1" title={`Priorité ${PRIORITY_LABEL[t.priority]}`}><Flag size={12} className={cn(t.priority === "haute" ? "text-red-500" : t.priority === "basse" ? "text-slate-400" : "text-sky-500")} />{PRIORITY_LABEL[t.priority]}</span>
                      {t.dueDate && <span className={cn("inline-flex items-center gap-1", late && "font-semibold text-danger")}><CalendarDays size={12} />{fmtDate(t.dueDate)}{late && " · en retard"}</span>}
                      {t.owner.id !== meId && <span className="inline-flex items-center gap-1"><UserRound size={12} />{t.owner.name}</span>}
                      {t.objectiveTitle && <span className="inline-flex max-w-full items-center gap-1 truncate"><Target size={12} /><span className="truncate">{t.objectiveTitle}</span></span>}
                      {t.assignedByOther && t.owner.id === meId && <span className="rounded bg-info-bg px-1.5 text-info-fg">Confiée par {t.createdBy.name.split(" ")[0]}</span>}
                    </div>
                    <div className="mt-2 flex justify-between">
                      <button type="button" disabled={idx === 0} onClick={() => onMove(t, COLS[idx - 1])} aria-label="Déplacer vers la colonne précédente" className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-ink-soft hover:bg-surface-muted disabled:invisible"><ArrowLeft size={16} /><span className="hidden sm:inline">{idx > 0 ? STATUS_LABEL[COLS[idx - 1]] : ""}</span></button>
                      <button type="button" disabled={idx === COLS.length - 1} onClick={() => onMove(t, COLS[idx + 1])} aria-label="Déplacer vers la colonne suivante" className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-ink-soft hover:bg-surface-muted disabled:invisible"><span className="hidden sm:inline">{idx < COLS.length - 1 ? STATUS_LABEL[COLS[idx + 1]] : ""}</span><ArrowRight size={16} /></button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      </div>
    </div>
  );
}
