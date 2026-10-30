import { apiFetch } from "./client";

// Planning : objectifs (OKR), tâches (Kanban + calendrier) — routes/planning.js.

export type TaskStatus = "a_faire" | "en_cours" | "termine";
export type TaskPriority = "basse" | "normale" | "haute";
export type Person = { id: number; name: string };

export type PlanningTask = {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  objectiveId: number | null;
  objectiveTitle: string | null;
  owner: Person;
  createdBy: Person;
  canEdit: boolean;
  assignedByOther: boolean;
};

export type KeyResult = { id: number; title: string; unit: string | null; targetValue: number; currentValue: number; progress: number };

export type Objective = {
  id: number;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  owner: Person;
  createdBy: Person;
  canEdit: boolean;
  keyResults: KeyResult[];
  tasksTotal: number;
  tasksDone: number;
  progress: number;
};

export type PlanningPerson = { id: number; name: string; roleLabel: string; me: boolean };

export type TaskInput = {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  startDate?: string | null;
  dueDate?: string | null;
  objectiveId?: number | null;
  ownerId?: number;
};
export type ObjectiveInput = { title: string; description?: string | null; startDate: string; endDate: string; ownerId?: number };

const J = { "Content-Type": "application/json" };
const send = <T>(accessToken: string, path: string, method: string, body?: unknown) =>
  apiFetch<T>(`/api/planning${path}`, { accessToken, method, headers: J, body: body === undefined ? undefined : JSON.stringify(body) });

export const planningPeople = (t: string) => apiFetch<{ people: PlanningPerson[]; canAssign: boolean }>("/api/planning/people", { accessToken: t });
export const planningTasks = (t: string) => apiFetch<{ tasks: PlanningTask[] }>("/api/planning/tasks", { accessToken: t });
export const createPlanningTask = (t: string, input: TaskInput) => send<{ task: PlanningTask }>(t, "/tasks", "POST", input);
export const updatePlanningTask = (t: string, id: number, input: Partial<TaskInput>) => send<{ task: PlanningTask }>(t, `/tasks/${id}`, "PATCH", input);
export const deletePlanningTask = (t: string, id: number) => send<void>(t, `/tasks/${id}`, "DELETE");

export const planningObjectives = (t: string) => apiFetch<{ objectives: Objective[] }>("/api/planning/objectives", { accessToken: t });
export const createObjective = (t: string, input: ObjectiveInput) => send<{ objective: Objective }>(t, "/objectives", "POST", input);
export const updateObjective = (t: string, id: number, input: Partial<ObjectiveInput>) => send<{ objective: Objective }>(t, `/objectives/${id}`, "PATCH", input);
export const deleteObjective = (t: string, id: number) => send<void>(t, `/objectives/${id}`, "DELETE");
export const addKeyResult = (t: string, objId: number, input: { title: string; unit?: string | null; targetValue: number; currentValue?: number }) =>
  send<{ objective: Objective }>(t, `/objectives/${objId}/key-results`, "POST", input);
export const updateKeyResult = (t: string, id: number, input: { title?: string; unit?: string | null; targetValue?: number; currentValue?: number }) =>
  send<{ objective: Objective }>(t, `/key-results/${id}`, "PATCH", input);
export const deleteKeyResult = (t: string, id: number) => send<{ objective: Objective }>(t, `/key-results/${id}`, "DELETE");
