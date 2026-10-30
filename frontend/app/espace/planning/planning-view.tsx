"use client";

import * as React from "react";
import { CalendarDays, Columns3, Plus, Target } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { RequireAuth } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import {
  planningObjectives, planningPeople, planningTasks, updatePlanningTask,
  type Objective, type PlanningPerson, type PlanningTask, type TaskStatus,
} from "@/lib/api/planning";
import { cn } from "@/lib/utils";
import { KanbanBoard } from "./kanban-board";
import { CalendarView } from "./calendar-view";
import { ObjectivesPanel } from "./objectives-panel";
import { TaskDialog } from "./task-dialog";
import { selectCls } from "./planning-shared";

type Tab = "kanban" | "calendrier" | "objectifs";
const TABS: { id: Tab; label: string; icon: typeof Columns3 }[] = [
  { id: "kanban", label: "Tableau", icon: Columns3 },
  { id: "calendrier", label: "Calendrier", icon: CalendarDays },
  { id: "objectifs", label: "Objectifs", icon: Target },
];

/**
 * Planning personnel : objectifs mesurables (OKR), tâches suivies en Kanban (à faire / en cours / terminé)
 * et calendrier. Chacun planifie le sien ; le DG voit ce qui le concerne et ce qu'il a confié à l'équipe.
 */
export function PlanningView() {
  return (
    <RequireAuth>
      <PlanningContent />
    </RequireAuth>
  );
}

function PlanningContent() {
  const { accessToken, user } = useAuth();
  const token = accessToken ?? "";
  const [tab, setTab] = React.useState<Tab>("kanban");
  const [tasks, setTasks] = React.useState<PlanningTask[] | null>(null);
  const [objectives, setObjectives] = React.useState<Objective[]>([]);
  const [people, setPeople] = React.useState<PlanningPerson[]>([]);
  const [canAssign, setCanAssign] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | number>("all");
  const [dialog, setDialog] = React.useState<{ task: PlanningTask | null; due?: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!token) return;
    try {
      const [t, o, p] = await Promise.all([planningTasks(token), planningObjectives(token), planningPeople(token)]);
      setTasks(t.tasks); setObjectives(o.objectives); setPeople(p.people); setCanAssign(p.canAssign); setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Impossible de charger le planning.");
    }
  }, [token]);
  React.useEffect(() => { load(); }, [load]);

  const meId = user?.id ?? 0;
  const visible = (tasks ?? []).filter((t) => filter === "all" || t.owner.id === filter);

  async function move(t: PlanningTask, status: TaskStatus) {
    const prev = tasks;
    setTasks((list) => (list ?? []).map((x) => (x.id === t.id ? { ...x, status } : x))); // mise à jour immédiate
    try { await updatePlanningTask(token, t.id, { status }); load(); }
    catch (e) { setTasks(prev); setError(e instanceof ApiError ? e.message : "Déplacement impossible."); }
  }

  const open = visible.filter((t) => t.status !== "termine").length;
  const done = visible.filter((t) => t.status === "termine").length;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-headline-md text-ink">Planning</h1>
          <p className="text-body-sm text-ink-soft">{open} en cours · {done} terminée(s)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAssign && people.length > 1 && (
            <select aria-label="Filtrer par personne" className={cn(selectCls, "w-auto min-w-[180px]")} value={filter} onChange={(e) => setFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">Toute l&apos;équipe (ce que je vois)</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.me ? "Moi" : p.name}</option>)}
            </select>
          )}
          <Button onClick={() => setDialog({ task: null })}><Plus size={16} /> Nouvelle tâche</Button>
        </div>
      </header>

      <div role="tablist" className="flex gap-1 rounded-xl bg-surface-muted p-1 sm:w-fit">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
            className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-body-sm font-medium transition-colors sm:flex-none",
              tab === t.id ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink")}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {error && <p className="rounded bg-danger-bg px-3 py-2 text-body-sm text-danger-fg" role="alert">{error}</p>}
      {tasks === null && !error && <p className="py-10 text-center text-body-sm text-ink-muted">Chargement…</p>}

      {tasks !== null && tab === "kanban" && (
        <KanbanBoard tasks={visible} meId={meId} onOpen={(t) => setDialog({ task: t })} onMove={move} onAdd={() => setDialog({ task: null })} />
      )}
      {tasks !== null && tab === "calendrier" && (
        <CalendarView tasks={visible} onOpen={(t) => setDialog({ task: t })} onAdd={(date) => setDialog({ task: null, due: date })} />
      )}
      {tasks !== null && tab === "objectifs" && (
        <ObjectivesPanel token={token} objectives={objectives.filter((o) => filter === "all" || o.owner.id === filter)} people={people} canAssign={canAssign} defaultOwner={meId} onChanged={load} />
      )}

      {dialog && (
        <TaskDialog
          key={dialog.task?.id ?? "new"}
          token={token}
          task={dialog.task}
          defaultDue={dialog.due}
          defaultOwner={filter !== "all" && canAssign ? filter : meId}
          people={people}
          canAssign={canAssign}
          objectives={objectives}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
}
