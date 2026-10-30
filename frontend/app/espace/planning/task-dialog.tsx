"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/client";
import {
  createPlanningTask, updatePlanningTask, deletePlanningTask,
  type Objective, type PlanningPerson, type PlanningTask, type TaskPriority, type TaskStatus,
} from "@/lib/api/planning";
import { Modal, STATUS_LABEL, PRIORITY_LABEL, selectCls, areaCls } from "./planning-shared";

/** Création / modification d'une tâche. Un propriétaire non créateur (tâche confiée) ne change que l'avancement. */
export function TaskDialog({
  token, task, defaultDue, defaultOwner, people, canAssign, objectives, onClose, onSaved,
}: {
  token: string;
  task: PlanningTask | null;
  defaultDue?: string;
  defaultOwner: number;
  people: PlanningPerson[];
  canAssign: boolean;
  objectives: Objective[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const readOnly = !!task && !task.canEdit;
  const [title, setTitle] = React.useState(task?.title ?? "");
  const [description, setDescription] = React.useState(task?.description ?? "");
  const [status, setStatus] = React.useState<TaskStatus>(task?.status ?? "a_faire");
  const [priority, setPriority] = React.useState<TaskPriority>(task?.priority ?? "normale");
  const [startDate, setStartDate] = React.useState(task?.startDate ?? "");
  const [dueDate, setDueDate] = React.useState(task?.dueDate ?? defaultDue ?? "");
  const [ownerId, setOwnerId] = React.useState(task?.owner.id ?? defaultOwner);
  const [objectiveId, setObjectiveId] = React.useState<number | "">(task?.objectiveId ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const ownerObjectives = objectives.filter((o) => o.owner.id === ownerId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setFieldErrors({});
    try {
      if (task && readOnly) {
        await updatePlanningTask(token, task.id, { status });
      } else {
        const input = {
          title, description: description.trim() || null, status, priority,
          startDate: startDate || null, dueDate: dueDate || null,
          objectiveId: objectiveId === "" ? null : objectiveId,
          ...(canAssign ? { ownerId } : {}),
        };
        if (task) await updatePlanningTask(token, task.id, input);
        else await createPlanningTask(token, input);
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) { setError(err.message); setFieldErrors(err.details ?? {}); } else setError("Enregistrement impossible.");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!task) return;
    setBusy(true);
    try { await deletePlanningTask(token, task.id); onSaved(); } catch (err) { setError(err instanceof ApiError ? err.message : "Suppression impossible."); setBusy(false); }
  }

  const fe = (k: string) => fieldErrors[k]?.[0];
  return (
    <Modal title={task ? (readOnly ? "Tâche confiée" : "Modifier la tâche") : "Nouvelle tâche"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        {readOnly && <p className="rounded bg-info-bg px-3 py-2 text-body-sm text-info-fg">Confiée par {task!.createdBy.name} : vous pouvez faire avancer son statut.</p>}
        <Field label="Titre" htmlFor="pt-title" required error={fe("title")}>
          <Input id="pt-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} autoFocus maxLength={200} placeholder="Ex. Relancer les loyers en retard" />
        </Field>
        <Field label="Description" htmlFor="pt-desc" error={fe("description")}>
          <textarea id="pt-desc" rows={3} className={areaCls} value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} maxLength={2000} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Statut" htmlFor="pt-status" hint="Où en est la tâche (colonne du tableau).">
            <select id="pt-status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Priorité" htmlFor="pt-prio" hint="Haute = à traiter en premier.">
            <select id="pt-prio" className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} disabled={readOnly}>
              {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </Field>
          <Field label="Début" htmlFor="pt-start" error={fe("startDate")} hint="Facultatif.">
            <Input id="pt-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="Échéance" htmlFor="pt-due" error={fe("dueDate")} hint="Place la tâche dans le calendrier.">
            <Input id="pt-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={readOnly} />
          </Field>
        </div>
        {canAssign && !readOnly && (
          <Field label="Confier à" htmlFor="pt-owner" error={fe("ownerId")} hint="Le collègue la verra dans son planning et pourra la faire avancer.">
            <select id="pt-owner" className={selectCls} value={ownerId} onChange={(e) => { setOwnerId(Number(e.target.value)); setObjectiveId(""); }}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.me ? `Moi (${p.name})` : `${p.name} — ${p.roleLabel}`}</option>)}
            </select>
          </Field>
        )}
        {!readOnly && (
          <Field label="Objectif lié" htmlFor="pt-obj" error={fe("objectiveId")} hint={ownerObjectives.length ? "Les tâches terminées font avancer cet objectif." : "Aucun objectif pour cette personne : créez-en un dans l'onglet Objectifs."}>
            <select id="pt-obj" className={selectCls} value={objectiveId} onChange={(e) => setObjectiveId(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">Aucun</option>
              {ownerObjectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          </Field>
        )}
        {error && <p className="text-body-sm text-danger" role="alert">{error}</p>}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          {task && task.canEdit ? (
            confirmDelete ? (
              <span className="flex items-center gap-2 text-body-sm">Supprimer ?
                <Button type="button" variant="danger" size="sm" onClick={remove} disabled={busy}>Oui</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Non</Button>
              </span>
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Supprimer</Button>
            )
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={busy || (!readOnly && title.trim().length < 2)}>{task ? "Enregistrer" : "Créer"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
