import { apiFetch } from "./client";

export type PermissionKey =
  | "locataires"
  | "proprietaires"
  | "etats_des_lieux"
  | "plaintes"
  | "comptabilite"
  | "charges"
  | "documents_juridiques";

export type EmployeeRole = "comptable" | "agent";

export type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  identifier: string;
  email: string | null;
  role: EmployeeRole;
  status: "active" | "disabled";
  mustChangePassword: boolean;
  permissions: PermissionKey[];
  createdAt: string;
};

export type PermissionCatalogEntry = { key: PermissionKey; label: string };

/** Bien géré par un agent (étape 14), tel qu'affiché sur sa fiche. */
export type ManagedProperty = { id: number; code: string; address: string | null; ownerName: string };

export function listEmployees(accessToken: string) {
  return apiFetch<{ employees: Employee[] }>("/api/employees", { accessToken });
}

export function getEmployee(accessToken: string, id: number) {
  return apiFetch<{ employee: Employee; managedProperties: ManagedProperty[] }>(`/api/employees/${id}`, {
    accessToken,
  });
}

/** Attribue un ou plusieurs Biens à cet agent en une fois (« pour la gestion »). */
export function assignProperties(accessToken: string, employeeId: number, propertyIds: number[]) {
  return apiFetch<{ managedProperties: ManagedProperty[] }>(`/api/employees/${employeeId}/properties`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ propertyIds }),
  });
}

/** Retire un Bien du portefeuille de cet agent (redevient non attribué). */
export function unassignProperty(accessToken: string, employeeId: number, propertyId: number) {
  return apiFetch<{ managedProperties: ManagedProperty[] }>(
    `/api/employees/${employeeId}/properties/${propertyId}`,
    { method: "DELETE", accessToken },
  );
}

export function fetchPermissionCatalog(accessToken: string) {
  return apiFetch<{ permissions: PermissionCatalogEntry[]; defaultsByRole: Record<string, PermissionKey[]> }>(
    "/api/employees/permissions",
    { accessToken },
  );
}

export type CreateEmployeeInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  role: EmployeeRole;
  permissions: PermissionKey[];
};

export function createEmployee(accessToken: string, input: CreateEmployeeInput) {
  // Identifiant et mot de passe temporaire toujours générés par le serveur.
  return apiFetch<{ employee: Employee; temporaryPassword: string }>("/api/employees", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type UpdateEmployeeInput = Partial<{
  firstName: string;
  lastName: string;
  email: string | null;
  role: EmployeeRole;
  status: "active" | "disabled";
  permissions: PermissionKey[];
}>;

export function updateEmployee(accessToken: string, id: number, input: UpdateEmployeeInput) {
  return apiFetch<{ employee: Employee }>(`/api/employees/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteEmployee(accessToken: string, id: number) {
  return apiFetch<void>(`/api/employees/${id}`, { method: "DELETE", accessToken });
}
