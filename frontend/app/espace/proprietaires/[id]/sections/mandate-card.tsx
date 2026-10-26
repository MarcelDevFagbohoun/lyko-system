"use client";

import * as React from "react";
import { UserX, UserCheck } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  endOwnerMandate,
  reactivateOwnerMandate,
  type Owner,
  type OwnerProperty,
} from "@/lib/api/owners";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";


/**
 * Archive des propriétaires (demande utilisateur, 2026-10-18) : contrairement à un bail, rien
 * n'indiquait jusqu'ici qu'un propriétaire avait quitté le cabinet — action VOLONTAIRE du DG
 * (jamais automatique sur « 0 Bien »), motif obligatoire, bloquée tant qu'il reste au moins un Bien
 * rattaché. Une fois le mandat terminé, la fiche devient en LECTURE SEULE (décision explicite) —
 * cette carte reste la seule porte de sortie (« Réactiver le mandat »), pour un règlement tardif
 * par exemple.
 */
export function MandateCard({
  owner,
  properties,
  accessToken,
  onChanged,
}: {
  owner: Owner;
  properties: OwnerProperty[];
  accessToken: string | null;
  onChanged: () => void;
}) {
  const [ending, setEnding] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  if (owner.mandateEndedAt) {
    async function handleReactivate() {
      if (!accessToken) return;
      setSubmitting(true);
      setError(null);
      try {
        await reactivateOwnerMandate(accessToken, owner.id);
        toast.success("Mandat réactivé.");
        onChanged();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Impossible de réactiver ce mandat.");
      } finally {
        setSubmitting(false);
      }
    }

    return (
      <Card className="border-warning-border bg-warning-bg">
        <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-label-md text-warning-fg">
              Mandat terminé le {new Date(owner.mandateEndedAt).toLocaleDateString("fr-FR")}
              {owner.mandateEndedBy && ` par ${owner.mandateEndedBy.name} (${owner.mandateEndedBy.roleLabel})`}
            </p>
            {owner.mandateEndReason && <p className="mt-1 text-body-sm text-ink-soft">Motif : {owner.mandateEndReason}</p>}
            <p className="mt-1 text-body-xs text-ink-muted">
              Fiche en lecture seule. Réactivez le mandat pour pouvoir à nouveau y enregistrer quelque chose.
            </p>
            {error && <p className="mt-1 text-body-xs text-danger-fg">{error}</p>}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={handleReactivate} disabled={submitting}>
            <UserCheck size={16} />
            {submitting ? "Réactivation…" : "Réactiver le mandat"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const blockedByProperties = properties.length > 0;

  async function handleEnd(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await endOwnerMandate(accessToken, owner.id, reason.trim());
      toast.success("Mandat terminé — ce propriétaire est désormais archivé.");
      setEnding(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de terminer ce mandat.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ending) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit text-ink-muted"
          onClick={() => setEnding(true)}
          disabled={blockedByProperties}
        >
          <UserX size={15} />
          Mettre fin au mandat
        </Button>
        {blockedByProperties && (
          <p className="text-body-xs text-ink-muted">
            Ce propriétaire a encore {properties.length} Bien{properties.length > 1 ? "s" : ""} rattaché
            {properties.length > 1 ? "s" : ""} — réattribuez-les d&apos;abord pour pouvoir terminer son mandat.
          </p>
        )}
      </div>
    );
  }

  return (
    <Card className="border-danger-border">
      <CardHeader>
        <CardTitle>Mettre fin au mandat de {owner.name}</CardTitle>
        <CardDescription>
          Ce propriétaire passera dans l&apos;archive, sa fiche en lecture seule. Réversible (« Réactiver le mandat »).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleEnd} className="flex flex-col gap-3">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <Field label="Motif" htmlFor="mandateReason" required>
            <textarea
              id="mandateReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              minLength={5}
              className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              placeholder="Pourquoi ce propriétaire quitte l'entreprise…"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="destructive" disabled={submitting}>
              {submitting ? "Enregistrement…" : "Confirmer la fin du mandat"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEnding(false)} disabled={submitting}>
              Annuler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Portail propriétaire (étape 13, idée n°1) : génère/régénère le lien secret
 * (sans mot de passe) donnant accès à sa recette du mois, son patrimoine et
 * l'historique de ses versements. Même révélation unique que le portail
 * locataire (`locataire-view.tsx`) et les identifiants d'un employé.
 */
