"use client";

import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { useToast, type ToastItem, type ToastVariant } from "@/lib/toast/toast-context";
import { cn } from "@/lib/utils";

const VARIANT_STYLE: Record<ToastVariant, { icon: typeof CheckCircle2; className: string; iconClassName: string }> = {
  success: { icon: CheckCircle2, className: "border-success-border bg-success-bg text-success-fg", iconClassName: "text-success" },
  warning: { icon: AlertTriangle, className: "border-warning-border bg-warning-bg text-warning-fg", iconClassName: "text-warning" },
  danger: { icon: XCircle, className: "border-danger-border bg-danger-bg text-danger-fg", iconClassName: "text-danger" },
  info: { icon: Info, className: "border-info-border bg-info-bg text-info-fg", iconClassName: "text-info" },
};

/**
 * Empilement de toasts, fixé en haut à droite (bas sur mobile pour rester
 * joignable au pouce). Monté une seule fois à la racine (`app/layout.tsx`) —
 * chaque écran se contente d'appeler `useToast()` pour afficher une
 * confirmation, sans jamais gérer sa propre présentation.
 */
export function ToastStack() {
  const { toasts, dismiss } = useToast();

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
  const { icon: Icon, className, iconClassName } = VARIANT_STYLE[toast.variant];
  return (
    <div
      role="status"
      className={cn(
        "animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-4 py-3 shadow-lg",
        className,
      )}
    >
      <Icon size={18} className={cn("mt-0.5 shrink-0", iconClassName)} />
      <p className="flex-1 text-body-sm">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fermer"
        className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}
