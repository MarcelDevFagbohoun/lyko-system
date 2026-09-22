"use client";

import * as React from "react";
import Link from "next/link";
import { UserPlus, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { listEmployees, type Employee } from "@/lib/api/employees";
import { ApiError } from "@/lib/api/client";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const ROLE_LABELS: Record<string, string> = { comptable: "Comptable", agent: "Agent" };

export function EmployesView() {
  return (
    <RequireAuth roles={["dg"]}>
      <EmployesContent />
    </RequireAuth>
  );
}

function EmployesContent() {
  const { accessToken, tenant } = useAuth();
  const [employees, setEmployees] = React.useState<Employee[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const res = await listEmployees(accessToken);
      setEmployees(res.employees);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de charger les employés.");
    }
  }, [accessToken]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-canvas">

      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Gestion des employés</h1>
            <p className="text-body-md text-ink-soft">
              Créez des comptes agent et comptable, et attribuez leurs accès par module.
            </p>
          </div>
          <Link href="/espace/employes/nouveau" className="w-fit">
            <Button>
              <UserPlus size={18} />
              Nouvel employé
            </Button>
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {employees === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : employees && employees.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <UserPlus size={28} className="text-ink-muted" />
              <p className="font-label-md text-ink">Aucun employé pour le moment</p>
              <p className="max-w-sm text-body-sm text-ink-muted">
                Créez un compte agent ou comptable pour commencer à déléguer les tâches de votre
                entreprise.
              </p>
              <Link href="/espace/employes/nouveau">
                <Button variant="secondary">Créer le premier employé</Button>
              </Link>
            </CardContent>
          </Card>
        ) : employees ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Employé</TableHead>
                <TableHead>Identifiant</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead className="text-center">Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {employees.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell>
                    <div className="font-label-md text-ink">
                      {emp.firstName} {emp.lastName}
                    </div>
                    <div className="text-body-xs text-ink-muted">
                      {emp.phone}
                      {emp.email ? ` · ${emp.email}` : ""}
                    </div>
                    <div className="text-body-xs text-ink-faint">
                      Créé le {new Date(emp.createdAt).toLocaleDateString("fr-FR")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="tabular font-currency-table text-ink">{emp.identifier}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">{tenant?.roleTitles?.[emp.role] ?? ROLE_LABELS[emp.role] ?? emp.role}</Badge>
                    {emp.role === "agent" && (
                      <div className="mt-1 text-body-xs text-ink-muted">
                        {emp.managedPropertiesCount > 0
                          ? `${emp.managedPropertiesCount} Bien${emp.managedPropertiesCount > 1 ? "s" : ""} attribué${emp.managedPropertiesCount > 1 ? "s" : ""}`
                          : "Tout le portefeuille"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {emp.permissions.length === 0 ? (
                        <span className="text-body-xs text-ink-muted">Aucune</span>
                      ) : (
                        emp.permissions.map((key) => (
                          <Badge key={key} variant="info" className="text-[10px]">
                            {key.replace(/_/g, " ")}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {emp.status === "active" ? (
                      <Badge variant="success" dot>
                        Actif
                      </Badge>
                    ) : (
                      <Badge variant="danger" dot>
                        Désactivé
                      </Badge>
                    )}
                    {emp.mustChangePassword && (
                      <div className="mt-1">
                        <Badge variant="warning" className="text-[10px]">
                          1ère connexion en attente
                        </Badge>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/espace/employes/${emp.id}`}>
                      <Button variant="ghost" size="sm">
                        <Pencil size={14} />
                        Modifier
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </div>
  );
}
