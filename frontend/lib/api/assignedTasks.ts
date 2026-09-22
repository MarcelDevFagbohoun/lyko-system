import { apiFetch } from "./client";

/**
 * Tâches à délai assignées par le DG à un employé précis (demande directe
 * de l'utilisateur) — distinct du tableau de bord agrégé « Mes tâches »
 * (lib/api/tasks.ts).
 */
export type AssignedTask = {
  id: number;
  title: string;
  description: string | null;
  dueDate: string;
  completedAt: string | null;
  assignedTo: { id: number; firstName: string; lastName: string };
  createdBy: { firstName: string; lastName: string };
  createdAt: string;
};

export function listAssignedTasks(accessToken: string) {
  return apiFetch<{ tasks: AssignedTask[] }>("/api/tasks/assigned", { accessToken });
}

export function createAssignedTask(
  accessToken: string,
  input: { title: string; description?: string; assignedTo: number; dueDate: string },
) {
  return apiFetch<{ task: AssignedTask }>("/api/tasks/assigned", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateAssignedTask(
  accessToken: string,
  id: number,
  input: { title?: string; description?: string; assignedTo?: number; dueDate?: string },
) {
  return apiFetch<{ task: AssignedTask }>(`/api/tasks/assigned/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function completeAssignedTask(accessToken: string, id: number) {
  return apiFetch<{ task: AssignedTask }>(`/api/tasks/assigned/${id}/complete`, {
    method: "PATCH",
    accessToken,
  });
}

export function reopenAssignedTask(accessToken: string, id: number) {
  return apiFetch<{ task: AssignedTask }>(`/api/tasks/assigned/${id}/reopen`, {
    method: "PATCH",
    accessToken,
  });
}

export function deleteAssignedTask(accessToken: string, id: number) {
  return apiFetch<void>(`/api/tasks/assigned/${id}`, {
    method: "DELETE",
    accessToken,
  });
}
