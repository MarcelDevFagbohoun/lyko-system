"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Check, RotateCcw, Trash2, ListTodo } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  listAssignedTasks,
  createAssignedTask,
  completeAssignedTask,
  reopenAssignedTask,
  deleteAssignedTask,
  type AssignedTask,
} from "@/lib/api/assignedTasks";
import { listEmployees, type Employee } from "@/lib/api/employees";
import { formatTaskDueLabel } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Tâches à délai assignées par le DG à un employé précis (demande directe
 * de l'utilisateur) : « fixer un délai pour chaque tâche, sans que la
 * personne n'ait encore fait ça il aura une notification ». Le DG crée et
 * assigne (cette page) ; le widget « Mes tâches » (tableau de bord)
 * affiche le décompte à l'employé concerné.
 */
export function TachesView() {
  return (
    <RequireAuth>
      <TachesContent />
    </RequireAuth>
  );
}

function urgencyBadgeVariant(urgency: ReturnType<typeof formatTaskDueLabel>["urgency"]) {
  if (urgency === "done") return "success" as const;
  if (urgency === "overdue" || urgency === "today") return "danger" as const;
  if (urgency === "soon") return "warning" as const;
  return "neutral" as const;
}

function TachesContent() {
  const { accessToken, user } = useAuth();
  const isDg = user?.role === "dg";

  const [tasks, setTasks] = React.useState<AssignedTask[] | null>(null);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [assignedTo, setAssignedTo] = React.useState<number | "">("");
  const [dueDate, setDueDate] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listAssignedTasks(accessToken)
      .then((res) => setTasks(res.tasks))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Impossible de charger les tâches."));
    if (isDg) {
      listEmployees(accessToken)
        .then((res) => setEmployees(res.employees.filter((e) => e.status === "active")))
        .catch(() => setEmployees([]));
    }
  }, [accessToken, isDg]);

  React.useEffect(() => load(), [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || assignedTo === "") return;
    setSubmitting(true);
    setFormError(null);
    try {
      await createAssignedTask(accessToken, {
        title,
        description: description.trim() || undefined,
        assignedTo,
        dueDate,
      });
      setTitle("");
      setDescription("");
      setAssignedTo("");
      setDueDate("");
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Impossible de créer la tâche.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete(id: number) {
    if (!accessToken) return;
    await completeAssignedTask(accessToken, id).catch(() => {});
    load();
  }
  async function handleReopen(id: number) {
    if (!accessToken) return;
    await reopenAssignedTask(accessToken, id).catch(() => {});
    load();
  }
  async function handleDelete(id: number) {
    if (!accessToken) return;
    await deleteAssignedTask(accessToken, id).catch(() => {});
    load();
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10">
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (!tasks) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour à mon espace
        </Link>

        <div>
          <h1 className="font-display text-headline-xl text-ink">Tâches</h1>
          <p className="text-body-md text-ink-soft">
            {isDg
              ? "Assignez une tâche avec une date limite à un employé — il sera averti tant qu'elle n'est pas terminée."
              : "Vos tâches assignées par la direction, avec leur date limite."}
          </p>
        </div>

        {isDg && (
          <Card>
            <CardHeader>
              <CardTitle>Nouvelle tâche</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="flex flex-col gap-3">
                {formError && (
                  <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                    {formError}
                  </div>
                )}
                <Field label="Titre" htmlFor="title" required>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                <Field label="Description (optionnel)" htmlFor="description">
                  <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Assignée à" htmlFor="assignedTo" required>
                    <select
                      id="assignedTo"
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : "")}
                      className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <option value="">Sélectionnez un employé</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.firstName} {emp.lastName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Date limite" htmlFor="dueDate" required>
                    <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </Field>
                </div>
                <Button type="submit" disabled={submitting || assignedTo === ""} className="self-start">
                  <Plus size={16} />
                  {submitting ? "Création…" : "Créer la tâche"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{isDg ? "Toutes les tâches" : "Mes tâches"}</CardTitle>
            <CardDescription>{tasks.length} tâche{tasks.length > 1 ? "s" : ""}.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {tasks.length === 0 ? (
              <p className="inline-flex items-center gap-2 text-body-sm text-ink-muted">
                <ListTodo size={16} />
                Aucune tâche pour l&apos;instant.
              </p>
            ) : (
              tasks.map((t) => {
                const due = formatTaskDueLabel(t.dueDate, t.completedAt);
                const canAct = isDg || t.assignedTo.id === user?.id;
                return (
                  <div
                    key={t.id}
                    className={`flex flex-col gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${
                      due.urgency === "overdue" || due.urgency === "today" ? "border-danger-border bg-danger-bg" : "border-border"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-label-md text-ink">{t.title}</span>
                      {t.description && <span className="text-body-xs text-ink-muted">{t.description}</span>}
                      {isDg && (
                        <span className="text-body-xs text-ink-muted">
                          Assignée à {t.assignedTo.firstName} {t.assignedTo.lastName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={urgencyBadgeVariant(due.urgency)}>{due.text}</Badge>
                      {canAct && !t.completedAt && (
                        <Button type="button" size="sm" variant="success" onClick={() => handleComplete(t.id)}>
                          <Check size={14} />
                          Terminée
                        </Button>
                      )}
                      {canAct && t.completedAt && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => handleReopen(t.id)}>
                          <RotateCcw size={14} />
                          Rouvrir
                        </Button>
                      )}
                      {isDg && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => handleDelete(t.id)}>
                          <Trash2 size={14} className="text-danger-fg" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
