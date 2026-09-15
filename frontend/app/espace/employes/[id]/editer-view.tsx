"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2, Check } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  getEmployee,
  updateEmployee,
  deleteEmployee,
  fetchPermissionCatalog,
  assignProperties,
  unassignProperty,
  type Employee,
  type PermissionCatalogEntry,
  type PermissionKey,
  type EmployeeRole,
  type ManagedProperty,
} from "@/lib/api/employees";
import { listProperties, type PropertyListItem } from "@/lib/api/properties";
import { RequireAuth } from "@/components/auth/require-auth";
import { PermissionPicker } from "@/components/employees/permission-picker";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/toast/toast-context";

export function EditerView() {
  return (
    <RequireAuth roles={["dg"]}>
      <EditerEmployeContent />
    </RequireAuth>
  );
}

function EditerEmployeContent() {
  const { id } = useParams<{ id: string }>();
  const employeeId = Number(id);
  const router = useRouter();
  const { accessToken } = useAuth();

  const [catalog, setCatalog] = React.useState<PermissionCatalogEntry[]>([]);
  const [employee, setEmployee] = React.useState<Employee | null>(null);
  const [managedProperties, setManagedProperties] = React.useState<ManagedProperty[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<EmployeeRole>("agent");
  const [status, setStatus] = React.useState<"active" | "disabled">("active");
  const [permissions, setPermissions] = React.useState<PermissionKey[]>([]);

  const [saving, setSaving] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const toast = useToast();

  React.useEffect(() => {
    if (!accessToken || !Number.isInteger(employeeId)) return;
    Promise.all([getEmployee(accessToken, employeeId), fetchPermissionCatalog(accessToken)])
      .then(([empRes, catRes]) => {
        const emp = empRes.employee;
        setEmployee(emp);
        setFirstName(emp.firstName);
        setLastName(emp.lastName);
        setEmail(emp.email ?? "");
        setRole(emp.role);
        setStatus(emp.status);
        setPermissions(emp.permissions);
        setCatalog(catRes.permissions);
        setManagedProperties(empRes.managedProperties);
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Employé introuvable.");
      });
  }, [accessToken, employeeId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    setServerError(null);
    try {
      const res = await updateEmployee(accessToken, employeeId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() ? email.trim() : null,
        role,
        status,
        permissions,
      });
      setEmployee(res.employee);
      toast.success("Modifications enregistrées.");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!accessToken) return;
    setDeleting(true);
    try {
      await deleteEmployee(accessToken, employeeId);
      router.push("/espace/employes");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Suppression impossible. Réessayez.");
      setDeleting(false);
      setConfirmDelete(false);
    }
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

  if (!employee) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link
          href="/espace/employes"
          className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={16} />
          Retour aux employés
        </Link>

        <Card className="max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>
                {employee.firstName} {employee.lastName}
              </CardTitle>
              {employee.mustChangePassword && <Badge variant="warning">1ère connexion en attente</Badge>}
            </div>
            <CardDescription>
              Identifiant <code className="tabular font-currency-table text-ink-soft">{employee.identifier}</code> ·
              {" "}{employee.phone} (non modifiables ici)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="flex flex-col gap-5" noValidate>
              {serverError && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {serverError}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Prénom" htmlFor="firstName" required>
                  <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </Field>
                <Field label="Nom" htmlFor="lastName" required>
                  <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </Field>
              </div>

              <Field label="Email (optionnel)" htmlFor="email">
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>

              <Field label="Rôle" htmlFor="role" required>
                <div className="flex gap-2">
                  {(["agent", "comptable"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`flex-1 rounded-lg border px-3 py-2 font-label-md transition-colors ${
                        role === r
                          ? "border-primary bg-surface-muted text-ink"
                          : "border-border text-ink-soft hover:bg-surface-hover"
                      }`}
                    >
                      {r === "agent" ? "Agent" : "Comptable"}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Statut du compte" htmlFor="status" required>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStatus("active")}
                    className={`flex-1 rounded-lg border px-3 py-2 font-label-md transition-colors ${
                      status === "active"
                        ? "border-success bg-success-bg text-success-fg"
                        : "border-border text-ink-soft hover:bg-surface-hover"
                    }`}
                  >
                    Actif
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus("disabled")}
                    className={`flex-1 rounded-lg border px-3 py-2 font-label-md transition-colors ${
                      status === "disabled"
                        ? "border-danger bg-danger-bg text-danger-fg"
                        : "border-border text-ink-soft hover:bg-surface-hover"
                    }`}
                  >
                    Désactivé
                  </button>
                </div>
                {status === "disabled" && (
                  <p className="text-body-xs text-ink-muted">
                    Un compte désactivé ne peut plus se connecter et ses sessions en cours sont
                    immédiatement révoquées.
                  </p>
                )}
              </Field>

              <div className="flex flex-col gap-2">
                <span className="font-label-sm text-ink-soft">Accès autorisés</span>
                <PermissionPicker catalog={catalog} value={permissions} onChange={setPermissions} />
              </div>

              <Button type="submit" size="lg" disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer les modifications"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-between">
            <span className="text-body-xs text-ink-muted">
              Créé le {new Date(employee.createdAt).toLocaleDateString("fr-FR")}
            </span>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-body-sm text-danger-fg">Confirmer la suppression ?</span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Annuler
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Suppression…" : "Oui, supprimer"}
                </Button>
              </div>
            ) : (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} />
                Supprimer le compte
              </Button>
            )}
          </CardFooter>
        </Card>

        {employee.role === "agent" && (
          <ManagedPropertiesCard
            employeeId={employeeId}
            properties={managedProperties}
            onChanged={setManagedProperties}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Biens gérés par cet agent (étape 14, « ajouter un nombre donné de Biens à
 * un agent pour la gestion ») — tant que la liste est vide, l'agent garde un
 * accès complet au portefeuille (comportement par défaut, voir
 * services/scope.js) ; dès qu'un Bien est ajouté ici, son accès se restreint
 * à ce sous-ensemble. Recherche + sélection multiple avant un seul appel
 * d'attribution, plutôt qu'un aller-retour par Bien.
 */
function ManagedPropertiesCard({
  employeeId,
  properties,
  onChanged,
}: {
  employeeId: number;
  properties: ManagedProperty[];
  onChanged: (properties: ManagedProperty[]) => void;
}) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<PropertyListItem[]>([]);
  const [showResults, setShowResults] = React.useState(false);
  const [selected, setSelected] = React.useState<Map<number, PropertyListItem>>(new Map());
  const [submitting, setSubmitting] = React.useState(false);
  const [removingId, setRemovingId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken || !showResults) return;
    const t = setTimeout(() => {
      listProperties(accessToken, query).then((res) => setResults(res.properties));
    }, 200);
    return () => clearTimeout(t);
  }, [query, accessToken, showResults]);

  const managedIds = new Set(properties.map((p) => p.id));

  function toggleSelect(p: PropertyListItem) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });
  }

  async function handleAssign() {
    if (!accessToken || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const count = selected.size;
      const res = await assignProperties(accessToken, employeeId, [...selected.keys()]);
      onChanged(res.managedProperties);
      setSelected(new Map());
      setQuery("");
      setShowResults(false);
      toast.success(count > 1 ? `${count} Biens attribués.` : "Bien attribué.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'attribuer ces Biens.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(propertyId: number) {
    if (!accessToken) return;
    setRemovingId(propertyId);
    setError(null);
    try {
      const res = await unassignProperty(accessToken, employeeId, propertyId);
      onChanged(res.managedProperties);
      toast.info("Bien retiré du portefeuille de cet agent.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de retirer ce Bien.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Biens gérés</CardTitle>
        <CardDescription>
          Cet agent ne voit et ne gère que les Biens listés ici. Tant qu&apos;aucun Bien ne lui est attribué, il
          garde un accès complet à tout le portefeuille.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {properties.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucun Bien attribué — accès complet au portefeuille pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {properties.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
              >
                <div>
                  <p className="font-label-md text-ink">{p.code}</p>
                  <p className="text-body-xs text-ink-muted">
                    {p.ownerName}
                    {p.address ? ` · ${p.address}` : ""}
                  </p>
                  {p.assignedAt && (
                    <p className="text-body-xs text-ink-faint">
                      Attribué le {new Date(p.assignedAt).toLocaleDateString("fr-FR")}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(p.id)}
                  disabled={removingId === p.id}
                  aria-label={`Retirer ${p.code}`}
                >
                  {removingId === p.id ? "Retrait…" : <Trash2 size={14} className="text-danger-fg" />}
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-border pt-4">
          {/* Puces + bouton toujours AU-DESSUS du champ de recherche : la liste
              déroulante ci-dessous est en position absolue et recouvrirait ce
              bloc s'il suivait le champ dans le flux normal — jamais cliquable
              une fois recouvert. */}
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {[...selected.values()].map((p) => (
                <Badge key={p.id} variant="info">
                  {p.code}
                </Badge>
              ))}
              <Button size="sm" onClick={handleAssign} disabled={submitting}>
                {submitting ? "Attribution…" : `Attribuer ${selected.size} Bien${selected.size > 1 ? "s" : ""}`}
              </Button>
            </div>
          )}

          <div className="relative">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              placeholder="Rechercher un bien par propriétaire ou code à ajouter"
            />
            {showResults && query.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface shadow-md">
                {results.filter((p) => !managedIds.has(p.id)).length === 0 ? (
                  <div className="px-3 py-3 text-body-sm text-ink-muted">Aucun bien trouvé.</div>
                ) : (
                  results
                    .filter((p) => !managedIds.has(p.id))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleSelect(p)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface-muted"
                      >
                        <div>
                          <p className="font-label-md text-ink">
                            {p.code} <span className="text-ink-muted">— {p.owner.name}</span>
                          </p>
                          {p.agent && (
                            <p className="text-body-xs text-warning-fg">
                              Actuellement géré par {p.agent.name} — sera réattribué
                            </p>
                          )}
                        </div>
                        {selected.has(p.id) && <Check size={16} className="shrink-0 text-primary" />}
                      </button>
                    ))
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
