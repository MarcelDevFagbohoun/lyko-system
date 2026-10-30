"use client";

import * as React from "react";
import { Bold, Eye, Heading2, Italic, List, ListOrdered, NotebookPen, Pencil, Plus } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { conflictSheet, getNoteSheet, saveNoteSheet, type EntityNote, type NoteSheet as Sheet, type SheetEntityType } from "@/lib/api/notes";
import { applyFormat, type FormatKind } from "@/lib/note-format";
import { cn } from "@/lib/utils";
import { SafeMarkdown } from "@/components/assistant/safe-markdown";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/toast/toast-context";

const TOOLS: { kind: FormatKind; label: string; icon: React.ReactNode }[] = [
  { kind: "heading", label: "Titre", icon: <Heading2 size={16} /> },
  { kind: "bold", label: "Gras", icon: <Bold size={16} /> },
  { kind: "italic", label: "Italique", icon: <Italic size={16} /> },
  { kind: "bullet", label: "Liste à puces", icon: <List size={16} /> },
  { kind: "numbered", label: "Liste numérotée", icon: <ListOrdered size={16} /> },
];

function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Fiche de notes d'un locataire ou d'un propriétaire : un seul document de texte mis en forme (titres, gras,
 * italique, listes), modifiable par toute l'équipe selon ses droits d'accès à la fiche. Les anciennes notes en
 * messages restent lisibles en dessous. Si quelqu'un d'autre enregistre pendant qu'on écrit, rien n'est écrasé :
 * on propose de recharger la fiche en gardant son brouillon.
 */
export function NoteSheet({
  entityType,
  entityId,
  accessToken,
  title = "Fiche de notes",
  placeholder = "Comportement de paiement, relation, situation, points d'attention…",
}: {
  entityType: SheetEntityType;
  entityId: number;
  accessToken: string | null;
  title?: string;
  placeholder?: string;
}) {
  const toast = useToast();
  const [sheet, setSheet] = React.useState<Sheet | null>(null);
  const [legacy, setLegacy] = React.useState<EntityNote[]>([]);
  const [editing, setEditing] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<Sheet | null>(null);
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    getNoteSheet(accessToken, entityType, entityId)
      .then((r) => { setSheet(r.sheet); setLegacy(r.legacyNotes); })
      .catch(() => setError("Fiche indisponible."));
  }, [accessToken, entityType, entityId]);

  const dirty = editing && sheet !== null && draft !== sheet.content;

  // Évite de perdre un brouillon en fermant l'onglet.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function startEdit() {
    if (!sheet) return;
    setDraft(sheet.content);
    setPreview(false);
    setError(null);
    setConflict(null);
    setEditing(true);
  }

  function format(kind: FormatKind) {
    const el = areaRef.current;
    if (!el) return;
    const edit = applyFormat(draft, el.selectionStart, el.selectionEnd, kind);
    setDraft(edit.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(edit.start, edit.end);
    });
  }

  async function save() {
    if (!accessToken || !sheet) return;
    setBusy(true);
    setError(null);
    try {
      const r = await saveNoteSheet(accessToken, entityType, entityId, draft, sheet.version);
      setSheet(r.sheet);
      setEditing(false);
      setConflict(null);
      toast.success("Fiche enregistrée.");
    } catch (err) {
      const current = conflictSheet(err);
      if (current) setConflict(current);
      else setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer la fiche.");
    } finally {
      setBusy(false);
    }
  }

  // Conflit : on adopte la version du serveur comme base, mais le brouillon de l'utilisateur est conservé tel quel.
  function keepMyDraftOnTopOfLatest() {
    if (!conflict) return;
    setSheet(conflict);
    setConflict(null);
  }

  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-tint-slate-solid shadow-sm ring-1 ring-border">
          <NotebookPen size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-headline-sm text-ink">{title}</h3>
          <p className="text-body-xs text-ink-muted">Partagée avec l&apos;équipe, selon les droits d&apos;accès.</p>
        </div>
        {!editing && sheet && sheet.version !== 0 && (
          <Button size="sm" variant="secondary" onClick={startEdit}>
            <Pencil size={14} /> Modifier
          </Button>
        )}
      </div>

      {error && <p className="text-body-sm text-danger-fg" role="alert">{error}</p>}

      {!editing ? (
        sheet && (
          sheet.content.trim() ? (
            <div className="rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
              <SafeMarkdown text={sheet.content} />
              {sheet.updatedAt && (
                <p className="mt-3 border-t border-border pt-2 text-body-xs text-ink-faint">
                  Dernière modification {sheet.updatedBy ? `par ${sheet.updatedBy.name} · ${sheet.updatedBy.roleLabel}, ` : ""}le {stamp(sheet.updatedAt)}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-7 text-center">
              <p className="max-w-md text-body-sm text-ink-muted">
                La fiche est vide. Notez ici ce qu&apos;il faut savoir sur cette personne : comportement de paiement, relation, points d&apos;attention.
              </p>
              <Button onClick={startEdit}>
                <Plus size={16} /> Remplir la fiche
              </Button>
            </div>
          )
        )
      ) : (
        <div className="flex flex-col gap-3">
         <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-sm focus-within:ring-2 focus-within:ring-primary">
          <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-muted px-2 py-1.5" role="toolbar" aria-label="Mise en forme">
            {TOOLS.map((t) => (
              <button
                key={t.kind}
                type="button"
                title={t.label}
                aria-label={t.label}
                disabled={preview}
                onClick={() => format(t.kind)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-soft hover:bg-surface disabled:opacity-40"
              >
                {t.icon}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPreview((p) => !p)}
              aria-pressed={preview}
              className={cn("ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-body-sm", preview ? "bg-primary/10 text-primary" : "text-ink-soft hover:bg-surface")}
            >
              <Eye size={14} /> Aperçu
            </button>
          </div>

          {preview ? (
            <div className="min-h-[180px] px-4 py-3">
              {draft.trim() ? <SafeMarkdown text={draft} /> : <p className="text-body-sm text-ink-muted">Rien à afficher.</p>}
            </div>
          ) : (
            <textarea
              ref={areaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              maxLength={20000}
              placeholder={placeholder}
              aria-label="Contenu de la fiche"
              className="block min-h-[180px] w-full resize-y border-0 bg-surface px-4 py-3 text-body-md text-ink placeholder:text-ink-faint focus:outline-none"
            />
          )}
          <p className="border-t border-border bg-surface-muted/60 px-4 py-1.5 text-right text-body-xs text-ink-faint">{draft.length} / 20 000 caractères</p>
         </div>

          {conflict && (
            <div className="rounded-lg border border-warning-border bg-warning-bg p-3 text-body-sm text-warning-fg" role="alert">
              <p>
                Quelqu&apos;un a modifié cette fiche pendant que vous écriviez
                {conflict.updatedBy ? ` (${conflict.updatedBy.name})` : ""}. Votre texte n&apos;est pas perdu.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={keepMyDraftOnTopOfLatest}>Garder mon texte et continuer</Button>
                <Button size="sm" variant="ghost" onClick={() => { setSheet(conflict); setDraft(conflict.content); setConflict(null); }}>
                  Abandonner mon texte, afficher la dernière version
                </Button>
              </div>
              <p className="mt-2 text-body-xs">En gardant votre texte, il remplacera la version de l&apos;autre personne à l&apos;enregistrement : copiez ce que vous voulez conserver de la sienne avant.</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy || !dirty}>{busy ? "Enregistrement…" : "Enregistrer"}</Button>
            <Button variant="ghost" onClick={() => { setEditing(false); setConflict(null); }} disabled={busy}>Annuler</Button>
          </div>
        </div>
      )}

      {legacy.length > 0 && (
        <details className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2">
          <summary className="cursor-pointer text-body-sm text-ink-soft">Anciennes notes ({legacy.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {legacy.map((n) => (
              <li key={n.id} className="rounded border border-border bg-surface px-3 py-2">
                <p className="text-body-xs text-ink-muted">
                  {n.author ? `${n.author.name} · ${n.author.roleLabel}` : "Auteur inconnu"} · {stamp(n.createdAt)}
                </p>
                <p className="whitespace-pre-wrap text-body-sm text-ink">{n.body}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
