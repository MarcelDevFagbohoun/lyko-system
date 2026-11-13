"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/errors/report";
import { Button } from "@/components/ui/button";

/**
 * Écran affiché quand une page plante (suivi des erreurs, demande utilisateur 2026-11-13) : au
 * lieu d'une page blanche, un message clair et un bouton pour réessayer — et l'erreur est
 * signalée au back-office pour être corrigée sans attendre qu'un client appelle.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 text-center sm:p-8">
        <h1 className="font-display text-headline-md text-ink">Cet écran a rencontré un problème</h1>
        <p className="mt-3 text-body-md text-ink-muted">
          Vos données ne sont pas perdues. Notre équipe vient d&apos;être prévenue automatiquement.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={reset}>Réessayer</Button>
          <Button variant="secondary" onClick={() => { window.location.href = "/espace"; }}>
            Retour à l&apos;accueil
          </Button>
        </div>
      </div>
    </main>
  );
}
