"use client";

import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { useToast, useToastList, type ToastItem, type ToastVariant } from "@/lib/toast/toast-context";
import { cn } from "@/lib/utils";

const VARIANT_STYLE: Record<ToastVariant, { icon: typeof CheckCircle2; className: string; iconClassName: string; bar: string; title: string }> = {
  success: { icon: CheckCircle2, className: "border-success-border bg-surface text-ink", iconClassName: "bg-success text-white", bar: "bg-success", title: "C'est fait" },
  warning: { icon: AlertTriangle, className: "border-warning-border bg-surface text-ink", iconClassName: "bg-warning text-white", bar: "bg-warning", title: "À vérifier" },
  danger: { icon: XCircle, className: "border-danger-border bg-surface text-ink", iconClassName: "bg-danger text-white", bar: "bg-danger", title: "Action impossible" },
  info: { icon: Info, className: "border-info-border bg-surface text-ink", iconClassName: "bg-info text-white", bar: "bg-info", title: "Information" },
};

// Même durée que `AUTO_DISMISS_MS` (lib/toast/toast-context.tsx) : la barre se vide quand le message part.
const TOAST_DURATION_MS = 4000;

/**
 * Empilement de toasts, fixé en haut à droite (bas sur mobile pour rester
 * joignable au pouce). Monté une seule fois à la racine (`app/layout.tsx`) —
 * chaque écran se contente d'appeler `useToast()` pour afficher une
 * confirmation, sans jamais gérer sa propre présentation.
 */
export function ToastStack() {
  const { dismiss } = useToast();
  const toasts = useToastList();

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[72px] z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { icon: Icon, className, iconClassName, bar, title } = VARIANT_STYLE[toast.variant];
  // Étape 55 : message plus visible — pastille d'icône pleine, titre court qui dit tout de suite si
  // l'action a réussi ou non, liseré de couleur et barre qui montre le temps restant.
  return (
    <div
      role={toast.variant === "danger" ? "alert" : "status"}
      className={cn(
        "animate-toast-in pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-lg border py-3 pl-4 pr-3 shadow-lg",
        className,
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", bar)} />
      <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", iconClassName)}>
        <Icon size={16} />
      </span>
      <div className="flex-1">
        <p className="font-label-md text-ink">{title}</p>
        <p className="text-body-sm text-ink-soft">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fermer"
        className="shrink-0 rounded p-0.5 text-ink-muted opacity-70 hover:opacity-100"
      >
        <X size={14} />
      </button>
      <span
        aria-hidden
        className={cn("absolute bottom-0 left-0 h-0.5 w-full origin-left opacity-60", bar)}
        style={{ animation: `toast-progress ${TOAST_DURATION_MS}ms linear forwards` }}
      />
    </div>
  );
}
