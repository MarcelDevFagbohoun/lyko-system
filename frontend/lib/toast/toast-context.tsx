"use client";

import * as React from "react";

export type ToastVariant = "success" | "warning" | "danger" | "info";
export type ToastItem = { id: number; variant: ToastVariant; message: string };

type ToastContextValue = {
  dismiss: (id: number) => void;
  show: (variant: ToastVariant, message: string) => void;
  success: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);
const ToastListContext = React.createContext<ToastItem[]>([]);

const AUTO_DISMISS_MS = 4000;

/**
 * Retour immédiat sur chaque action (demande utilisateur : « je veux que la
 * plateforme soit très réactive ») — remplace les bandeaux inline qui
 * apparaissaient noyés dans la page par une confirmation visible tout de
 * suite, au même endroit, quel que soit l'écran. Empilable (plusieurs
 * actions rapides = plusieurs toasts visibles), auto-disparition après
 * quelques secondes, fermeture manuelle possible.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = React.useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, variant, message }]);
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  React.useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((t) => clearTimeout(t));
      activeTimers.clear();
    };
  }, []);

  // Objet d'actions STABLE (jamais recréé quand la liste change) : la plupart des écrans le mettent dans les
  // dépendances d'un `useEffect`/`useCallback` de chargement. S'il changeait à chaque toast, une erreur de
  // chargement affichait un toast, ce qui relançait le chargement, qui échouait, qui affichait un toast…
  // à l'infini (page Abonnement : pluie de toasts et requêtes en boucle).
  const value = React.useMemo<ToastContextValue>(
    () => ({
      dismiss,
      show,
      success: (message) => show("success", message),
      warning: (message) => show("warning", message),
      error: (message) => show("danger", message),
      info: (message) => show("info", message),
    }),
    [dismiss, show],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastListContext.Provider value={toasts}>{children}</ToastListContext.Provider>
    </ToastContext.Provider>
  );
}

/** Liste des toasts affichés — réservé au conteneur d'affichage (le seul à devoir se redessiner à chaque toast). */
export function useToastList() {
  return React.useContext(ToastListContext);
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé à l'intérieur de <ToastProvider>");
  return ctx;
}
