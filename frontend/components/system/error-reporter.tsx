"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { reportClientError } from "@/lib/errors/report";

/**
 * Remonte au back-office les erreurs JavaScript non interceptées du navigateur (clic qui ne fait
 * rien, promesse rejetée…) — celles qui ne font pas planter toute la page et que personne ne voit
 * autrement. Les plantages complets d'un écran passent par `app/error.tsx`.
 */
export function ErrorReporter() {
  const { accessToken } = useAuth();
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message, accessToken);
    const onRejection = (e: PromiseRejectionEvent) => {
      // Une réponse d'erreur normale de l'API (formulaire refusé, session expirée) ou une coupure
      // réseau n'est pas une panne de l'application.
      const reason = e.reason;
      if (reason instanceof Error && (reason.name === "ApiError" || reason.name === "AbortError" || reason instanceof TypeError && /fetch|network/i.test(reason.message))) return;
      reportClientError(reason, accessToken);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [accessToken]);
  return null;
}
