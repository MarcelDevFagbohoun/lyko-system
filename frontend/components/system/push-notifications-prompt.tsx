"use client";

import * as React from "react";
import { Bell, X } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { enablePush, getPushState, type PushSupport } from "@/lib/push/subscribe";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DISMISSED_KEY = "aim-push-dismissed";

/**
 * Bandeau discret proposant d'activer les notifications push du navigateur
 * (comme une app) — visible pour TOUS les rôles connectés (dg, comptable,
 * agent), contrairement à l'assistant IA qui a ses propres conditions
 * d'activation. Ne s'affiche que si le navigateur supporte le push, que la
 * permission n'a pas déjà été refusée, qu'aucun abonnement n'existe encore
 * pour cet appareil, et que l'utilisateur ne l'a pas déjà fermé.
 *
 * `localStorage` ici n'est qu'un confort local à ce navigateur (ne pas
 * reproposer juste après une fermeture) — rien d'important n'en dépend : le
 * véritable état (abonné ou non) vient de `getPushState()` à chaque montage.
 */
export function PushNotificationsPrompt() {
  const { accessToken } = useAuth();
  const [state, setState] = React.useState<PushSupport | "checking">("checking");
  const [dismissed, setDismissed] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
    getPushState().then(setState).catch(() => setState("unsupported"));
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Stockage indisponible (navigation privée...) : sans conséquence, juste reproposé plus tard.
    }
  };

  const handleEnable = async () => {
    if (!accessToken) return;
    setPending(true);
    setError(false);
    try {
      const ok = await enablePush(accessToken);
      if (ok) {
        setState("subscribed");
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  if (dismissed || state === "checking" || state !== "available") return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-4 z-40 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-lg",
        "animate-page-in",
      )}
      role="status"
    >
      <Bell size={20} className="mt-0.5 shrink-0 text-primary" />
      <div className="flex-1">
        <p className="font-label-md text-ink">Activer les notifications</p>
        <p className="mt-1 text-body-sm text-ink-muted">
          Reçois les alertes importantes directement sur cet appareil, même quand l&apos;onglet est fermé.
        </p>
        {error && (
          <p className="mt-1 text-body-sm text-danger-fg">
            Impossible d&apos;activer les notifications. Réessaie, ou vérifie les réglages de notifications de ton navigateur.
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" size="sm" onClick={handleEnable} disabled={pending}>
            {pending ? "Activation..." : "Activer"}
          </Button>
          <Button variant="ghost" size="sm" onClick={dismiss} disabled={pending}>
            Plus tard
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Fermer"
        className="shrink-0 rounded p-1 text-ink-muted hover:bg-primary-bg hover:text-ink"
      >
        <X size={16} />
      </button>
    </div>
  );
}
