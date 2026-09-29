"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

/**
 * Réouverture d'une fiche finalisée (étape 48, DG uniquement) — motif
 * obligatoire, tracé au journal d'activité. Partagé entrée/sortie : seule la
 * fonction d'appel (`onReopen`) diffère entre les deux pages.
 */
export function ReopenReportButton({ onReopen }: { onReopen: (reason: string) => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    if (reason.trim().length < 10) {
      setError("Motif trop court (10 caractères minimum).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onReopen(reason.trim());
      setOpen(false);
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de rouvrir cette fiche.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="warning" size="sm" onClick={() => setOpen(true)}>
        <RotateCcw size={14} />
        Rouvrir pour corriger
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-bg p-3">
      <p className="font-label-sm text-warning-fg">
        Rouvrir invalide les deux signatures existantes — il faudra les reprendre avant de refinaliser.
      </p>
      <textarea
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Motif de la correction (obligatoire, 10 caractères minimum)"
        className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="button" variant="warning" size="sm" onClick={handleConfirm} disabled={submitting}>
          {submitting ? "Réouverture…" : "Confirmer la réouverture"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
