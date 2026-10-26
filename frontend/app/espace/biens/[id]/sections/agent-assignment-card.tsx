"use client";

import * as React from "react";
import { UserCog, UserX } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { type Property } from "@/lib/api/properties";
import {
  listEmployees,
  assignProperties,
  unassignProperty,
  type Employee,
} from "@/lib/api/employees";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";


/**
 * Attribution à un agent (étape 14) — directement depuis la fiche du Bien,
 * en complément de la carte équivalente sur la fiche de l'employé (seul
 * endroit qui existait jusqu'ici). Un DG cherchant « à qui confier CE bien »
 * regarde naturellement la fiche du Bien, pas celle d'un employé au hasard —
 * absence remontée comme « l'attribution ne marche pas » alors que le
 * mécanisme lui-même (back-end, restriction de portée) fonctionnait déjà.
 * Réservée au DG (même règle que le routeur `employees.js`, DG uniquement).
 */
export function AgentAssignmentCard({
  property,
  accessToken,
  onSaved,
}: {
  property: Property;
  accessToken: string | null;
  onSaved: () => void;
}) {
  const [agents, setAgents] = React.useState<Employee[] | null>(null);
  const [selected, setSelected] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (!accessToken) return;
    listEmployees(accessToken)
      .then((res) => setAgents(res.employees.filter((e) => e.role === "agent" && e.status === "active")))
      .catch(() => setAgents([]));
  }, [accessToken]);

  async function handleAssign() {
    if (!accessToken || !selected) return;
    setSaving(true);
    setError(null);
    try {
      await assignProperties(accessToken, Number(selected), [property.id]);
      setSelected("");
      onSaved();
      toast.success("Bien attribué à l'agent.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Attribution impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnassign() {
    if (!accessToken || !property.agent) return;
    setSaving(true);
    setError(null);
    try {
      await unassignProperty(accessToken, property.agent.id, property.id);
      onSaved();
      toast.info("Attribution retirée — ce Bien redevient accessible à tout agent sans portefeuille.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de retirer l'attribution.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserCog size={16} className="text-ink-muted" />
          <CardTitle>Agent responsable</CardTitle>
        </div>
        <CardDescription>
          Un agent sans aucun Bien attribué garde de toute façon un accès complet au
          portefeuille — l&apos;attribution ne restreint un agent qu&apos;à partir de son
          premier Bien reçu.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {property.agent ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
            <span className="text-body-sm text-ink">
              Géré par <span className="font-label-md">{property.agent.name}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={handleUnassign} disabled={saving}>
              <UserX size={14} />
              Retirer
            </Button>
          </div>
        ) : agents === null ? (
          <p className="text-body-sm text-ink-muted">Chargement des agents…</p>
        ) : agents.length === 0 ? (
          <p className="text-body-sm text-ink-muted">
            Aucun agent actif dans l&apos;entreprise. Créez-en un depuis « Employés ».
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="h-[38px] flex-1 rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">Choisir un agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>
              ))}
            </select>
            <Button size="sm" onClick={handleAssign} disabled={saving || !selected}>
              {saving ? "…" : "Attribuer"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Action « le locataire a quitté » : termine le bail actif et remet l'unité « Libre ». */
