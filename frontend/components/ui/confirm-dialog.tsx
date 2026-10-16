"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Confirmation avant tout enregistrement d'argent (demande explicite de l'utilisateur, 2026-10-16) :
 * un paiement de loyer, un règlement de charge, un versement propriétaire, un reversement de charges
 * ou une dépense ne part JAMAIS vers le serveur directement au clic sur « Enregistrer » — ce bouton
 * ouvre cette boîte de dialogue, qui récapitule (montant, personne/tiers, nature) et n'envoie la
 * requête qu'après confirmation explicite. Volontairement une MODALE (bloque l'écran) plutôt qu'une
 * notification toast, pour qu'un enregistrement d'argent ne puisse jamais passer inaperçu.
 *
 * Générique : chaque écran construit son propre récapitulatif (`description`) et sa propre icône
 * (`icon`) ; ce composant ne connaît rien du métier, seulement la mécanique confirmer/annuler.
 */
export function ConfirmDialog({
  open,
  icon: Icon,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  confirmVariant = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  icon: LucideIcon;
  title: string;
  /** Récapitulatif de l'action — peut être un texte simple ou un bloc riche (montant mis en avant, etc.). */
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonProps["variant"];
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Échap annule — jamais confirme (un enregistrement d'argent n'est jamais déclenché par une touche
  // de sortie) ; aucun effet pendant l'envoi (`busy`), pour ne pas fermer la modale sous la requête.
  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-bg text-primary")}>
            <Icon size={20} />
          </span>
          <div className="flex flex-col gap-1 pt-1">
            <h2 id="confirm-dialog-title" className="font-display text-headline-sm text-ink">
              {title}
            </h2>
            <div className="text-body-sm text-ink-soft">{description}</div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={confirmVariant} onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
