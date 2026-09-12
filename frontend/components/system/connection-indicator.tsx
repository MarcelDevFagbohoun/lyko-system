"use client";

import * as React from "react";
import { RotateCw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { subscribeQueue, isSyncing, retryQueueItem, discardQueueItem, processQueue } from "@/lib/offline/queue";
import type { QueueItem } from "@/lib/offline/db";

/**
 * Indicateur d'état de connexion permanent (section 2 du cahier des charges).
 * Étape 11 : reflète aussi la file d'attente hors-ligne — nombre d'actions en
 * attente de synchronisation, l'état « synchronisation en cours », et un
 * panneau au clic pour voir/relancer/abandonner chaque action (jamais de
 * résolution automatique silencieuse d'un échec de synchronisation).
 *
 * Rendu volontairement compact — un simple point de couleur dans un bouton
 * rond, jamais un texte qui grandit (« Hors-ligne · 3 en attente ») et peut
 * casser sur plusieurs lignes dans l'en-tête. Le libellé complet reste
 * disponible en info-bulle (`title`) et pour les lecteurs d'écran
 * (`aria-label`) ; le panneau au clic donne le détail complet.
 */
type ConnState = "online" | "offline" | "syncing";

const KIND_LABEL: Record<QueueItem["kind"], string> = {
  rent_payment: "Paiement de loyer",
  complaint: "Plainte",
};

export function ConnectionIndicator({ className }: { className?: string }) {
  const { accessToken } = useAuth();
  const [state, setState] = React.useState<ConnState>("online");
  const [mounted, setMounted] = React.useState(false);
  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setMounted(true);
    const update = () => setState(navigator.onLine ? "online" : "offline");
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  React.useEffect(() => subscribeQueue(setQueue), []);

  React.useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Évite le mismatch d'hydratation : rendu neutre côté serveur.
  const baseState: ConnState = mounted ? state : "online";
  const pendingCount = queue.filter((q) => q.status !== "syncing").length;
  const failedCount = queue.filter((q) => q.status === "failed").length;
  const effective: ConnState = baseState === "online" && isSyncing() ? "syncing" : baseState;

  const config: Record<ConnState, { label: string; dot: string; ring: string }> = {
    online: {
      label: "En ligne",
      dot: "bg-success",
      ring: "",
    },
    offline: {
      label: pendingCount > 0 ? `Hors-ligne · ${pendingCount} en attente` : "Hors-ligne",
      dot: "bg-danger",
      ring: "ring-2 ring-danger/30",
    },
    syncing: {
      label: "Synchronisation…",
      dot: "bg-warning animate-pulse-dot",
      ring: "ring-2 ring-warning/30",
    },
  };

  const c = config[effective];
  const hasQueue = queue.length > 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => hasQueue && setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup={hasQueue ? "true" : undefined}
        aria-label={pendingCount > 0 ? `${c.label} — ${pendingCount} action(s) en attente` : c.label}
        title={pendingCount > 0 ? `${c.label} — ${pendingCount} action(s) en attente` : c.label}
        className={cn(
          "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
          c.ring,
          hasQueue ? "cursor-pointer hover:bg-surface-muted" : "cursor-default",
          className,
        )}
      >
        <span role="status" aria-live="polite" className="sr-only">
          {c.label}
        </span>
        <span className={cn("h-2.5 w-2.5 rounded-full", c.dot)} aria-hidden />
        {pendingCount > 0 && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white",
              failedCount > 0 ? "bg-danger" : "bg-warning",
            )}
            aria-hidden
          >
            {pendingCount}
          </span>
        )}
      </button>

      {open && hasQueue && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-border bg-surface p-2 shadow-lg">
          <div className="flex items-center justify-between px-1 py-1">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">
              File hors-ligne ({queue.length})
            </span>
            <button type="button" onClick={() => setOpen(false)} className="text-ink-muted hover:text-ink">
              <X size={14} />
            </button>
          </div>
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {queue.map((item) => (
              <div key={item.id} className="rounded-lg border border-border bg-surface-muted px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-label-sm text-ink">{KIND_LABEL[item.kind]}</span>
                  <span
                    className={cn(
                      "font-label-sm text-[10px] uppercase tracking-wider",
                      item.status === "failed" ? "text-danger-fg" : item.status === "syncing" ? "text-warning-fg" : "text-ink-muted",
                    )}
                  >
                    {item.status === "failed" ? "Échec" : item.status === "syncing" ? "Envoi…" : "En attente"}
                  </span>
                </div>
                <p className="mt-0.5 text-body-xs text-ink-soft">{item.summary}</p>
                {item.error && <p className="mt-0.5 text-body-xs text-danger-fg">{item.error}</p>}
                {item.status === "failed" && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => retryQueueItem(item.id, accessToken)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-body-xs text-primary hover:bg-surface"
                    >
                      <RotateCw size={12} /> Réessayer
                    </button>
                    <button
                      type="button"
                      onClick={() => discardQueueItem(item.id)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-body-xs text-danger-fg hover:bg-surface"
                    >
                      <Trash2 size={12} /> Abandonner
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {baseState === "online" && !isSyncing() && (
            <button
              type="button"
              onClick={() => processQueue(accessToken)}
              className="mt-1.5 w-full rounded-lg border border-border-strong px-2 py-1.5 text-body-xs text-ink-soft hover:bg-surface-muted"
            >
              Synchroniser maintenant
            </button>
          )}
        </div>
      )}
    </div>
  );
}
