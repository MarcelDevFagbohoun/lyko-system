"use client";

import * as React from "react";
import { Send } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { addNote, listNotes, type EntityNote, type NoteEntityType } from "@/lib/api/notes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Couleur de la bulle selon le rôle de l'auteur : on reconnaît d'un coup d'œil qui a écrit. */
const ROLE_STYLE: Record<string, string> = {
  dg: "border-primary/30 bg-primary/10",
  comptable: "border-success-border bg-success-bg",
  agent: "border-warning-border bg-warning-bg",
};
const ROLE_DOT: Record<string, string> = { dg: "bg-primary", comptable: "bg-success", agent: "bg-warning" };

function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Fil de notes façon messagerie : chaque note est une bulle colorée selon le rôle de son auteur, datée à la
 * minute, la plus récente en haut. Les notes ne sont jamais modifiées (piste d'audit).
 */
export function NoteThread({
  entityType,
  entityId,
  accessToken,
  title = "Notes",
  placeholder = "Écrire une note visible par toute l'équipe…",
}: {
  entityType: NoteEntityType;
  entityId: number;
  accessToken: string | null;
  title?: string;
  placeholder?: string;
}) {
  const [notes, setNotes] = React.useState<EntityNote[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    listNotes(accessToken, entityType, entityId).then((r) => setNotes(r.notes)).catch(() => setError("Notes indisponibles."));
  }, [accessToken, entityType, entityId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setNotes((await addNote(accessToken, entityType, entityId, text.trim())).notes);
      setText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer la note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex max-w-2xl flex-col gap-3" aria-label={title}>
      <h3 className="font-label-md text-ink">{title}</h3>
      <form onSubmit={submit} className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={placeholder}
          className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <Button type="submit" disabled={busy || !text.trim()} aria-label="Envoyer la note">
          <Send size={16} />
        </Button>
      </form>
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      <ul className="flex flex-col gap-2.5">
        {notes.map((n) => (
          <li key={n.id} className={cn("rounded-2xl rounded-tl-sm border px-3.5 py-2.5", ROLE_STYLE[n.author?.role ?? ""] ?? "border-border bg-surface-muted")}>
            <div className="mb-1 flex flex-wrap items-center gap-x-2 text-body-xs text-ink-muted">
              <span className={cn("inline-block h-2 w-2 rounded-full", ROLE_DOT[n.author?.role ?? ""] ?? "bg-ink-faint")} />
              <span className="font-label-sm text-ink">{n.author ? `${n.author.name} · ${n.author.roleLabel}` : "Auteur inconnu"}</span>
              <time dateTime={n.createdAt}>{stamp(n.createdAt)}</time>
            </div>
            <p className="whitespace-pre-wrap text-body-sm text-ink">{n.body}</p>
          </li>
        ))}
        {notes.length === 0 && <li className="text-body-sm text-ink-muted">Aucune note pour l&apos;instant.</li>}
      </ul>
    </section>
  );
}
