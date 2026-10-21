"use client";

import * as React from "react";
import { CreditCard } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

/**
 * Bouton « Payer maintenant » — demande au serveur d'ouvrir une page de paiement FedaPay, puis y redirige.
 * Aucune clé ni référence n'est manipulée ici : le serveur crée la transaction, relit son statut au retour
 * (page `/paiement/retour`) et enregistre le paiement. Partagé entre le portail locataire et la page publique
 * de paiement par lien (`/payer/[token]`).
 */
export function PayNowButton({
  start,
  label = "Payer maintenant",
}: {
  start: () => Promise<{ url: string }>;
  label?: string;
}) {
  const [paying, setPaying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handlePay() {
    setPaying(true);
    setError(null);
    try {
      const { url } = await start();
      // Garde-fou : on ne redirige que vers FedaPay, jamais vers une adresse arbitraire.
      const host = new URL(url).hostname;
      if (!/(^|\.)fedapay\.com$/i.test(host)) throw new Error("Adresse de paiement inattendue.");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Paiement impossible.");
      setPaying(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button type="button" variant="success" onClick={handlePay} disabled={paying}>
        <CreditCard size={16} />
        {paying ? "Redirection…" : label}
      </Button>
      {error && <p className="text-body-xs text-danger-fg">{error}</p>}
    </div>
  );
}
