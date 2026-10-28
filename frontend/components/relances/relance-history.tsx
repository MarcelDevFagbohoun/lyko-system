"use client";

import * as React from "react";
import { setRelanceOutcome, type Relance } from "@/lib/api/relances";
import { ApiError } from "@/lib/api/client";
import { formatDateLabel } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/toast/toast-context";

/**
 * Liste des relances déjà envoyées pour un dossier (bail ou facture de charge), chacune avec son
 * retour (réponse du locataire, suite donnée) — ajoutable/modifiable par n'importe qui ayant accès au
 * dossier, pas seulement l'auteur de l'envoi (demande utilisateur, 2026-10-28).
 */
export function RelanceHistory({
  relances,
  accessToken,
  onChanged,
}: {
  relances: Relance[] | null;
  accessToken: string | null;
  onChanged: () => void;
}) {
  if (relances === null) return <p className="text-body-sm text-ink-muted">Chargement…</p>;
  if (relances.length === 0) return <p className="text-body-sm text-ink-muted">Aucune relance enregistrée pour le moment.</p>;
  return (
    <div className="flex flex-col gap-2">
      {relances.map((r) => (
        <RelanceRow key={r.id} relance={r} accessToken={accessToken} onChanged={onChanged} />
      ))}
    </div>
  );
}

function RelanceRow({
  relance,
  accessToken,
  onChanged,
}: {
  relance: Relance;
  accessToken: string | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [note, setNote] = React.useState(relance.outcomeNote ?? "");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSave() {
    if (!accessToken || !note.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await setRelanceOutcome(accessToken, relance.id, note.trim());
      setEditing(false);
      toast.success("Retour enregistré.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce retour.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <span className="text-body-sm text-ink">
        Relancé le {formatDateLabel(relance.sentAt)}
        {relance.sentBy && ` par ${relance.sentBy.name}`}
      </span>

      {error && <p className="mt-1 text-body-sm text-danger-fg">{error}</p>}

      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ce que le locataire a répondu, ce qui a été convenu…"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave} disabled={submitting || !note.trim()}>
              {submitting ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setEditing(false); setNote(relance.outcomeNote ?? ""); setError(null); }}
              disabled={submitting}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : relance.outcomeNote ? (
        <div className="mt-1 flex items-start justify-between gap-2">
          <p className="text-body-sm text-ink-soft">{relance.outcomeNote}</p>
          <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-body-xs text-primary hover:underline">
            Modifier
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="mt-1 block text-body-xs text-primary hover:underline">
          + Ajouter un retour
        </button>
      )}
    </div>
  );
}
