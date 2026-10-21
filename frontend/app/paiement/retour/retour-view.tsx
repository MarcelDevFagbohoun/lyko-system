"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { confirmOnlinePayment } from "@/lib/api/paymentLinks";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Page de retour après la page de paiement FedaPay (publique). Elle ne croit RIEN de l'adresse : elle demande au
 * serveur de relire la transaction chez FedaPay (référence aléatoire à usage unique) et affiche le résultat.
 * Tant que le paiement est « en attente » (validation Mobile Money en cours), elle ré-interroge toutes les 4 s.
 */
export function RetourView() {
  const ref = useSearchParams().get("ref") ?? "";
  const [state, setState] = React.useState<"loading" | "paid" | "pending" | "failed">("loading");
  const tries = React.useRef(0);

  React.useEffect(() => {
    if (!/^[a-f0-9]{32}$/.test(ref)) {
      setState("failed");
      return;
    }
    let stop = false;
    async function check() {
      try {
        const r = await confirmOnlinePayment(ref);
        if (stop) return;
        setState(r.state);
        tries.current += 1;
        if (r.state === "pending" && tries.current < 45) setTimeout(check, 4000);
      } catch {
        if (!stop) setState("failed");
      }
    }
    check();
    return () => {
      stop = true;
    };
  }, [ref]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          {state === "paid" && (
            <>
              <CheckCircle2 size={32} className="text-success-fg" />
              <p className="font-label-md text-success-fg">Paiement confirmé</p>
              <p className="text-body-sm text-ink-muted">
                Merci ! Votre règlement est enregistré. Vous recevrez un e-mail de confirmation si une adresse est renseignée, et
                votre quittance sera disponible dans votre espace locataire.
              </p>
            </>
          )}
          {(state === "loading" || state === "pending") && (
            <>
              <Clock size={32} className="text-warning-fg" />
              <p className="font-label-md text-ink">Vérification de votre paiement…</p>
              <p className="text-body-sm text-ink-muted">Validez l&apos;opération sur votre téléphone si nécessaire. Cette page se met à jour toute seule.</p>
            </>
          )}
          {state === "failed" && (
            <>
              <AlertTriangle size={32} className="text-danger-fg" />
              <p className="font-label-md text-danger-fg">Paiement non abouti</p>
              <p className="text-body-sm text-ink-muted">Aucun montant n&apos;a été enregistré. Vous pouvez réessayer depuis votre lien ou votre portail.</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
