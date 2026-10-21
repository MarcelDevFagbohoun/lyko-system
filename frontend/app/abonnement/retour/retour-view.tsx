"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { confirmSubscriptionPayment } from "@/lib/api/billing";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Retour du paiement d'abonnement : ne croit rien de l'adresse, demande au serveur de relire la transaction. */
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
        const r = await confirmSubscriptionPayment(ref);
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
              <p className="font-label-md text-success-fg">Abonnement activé</p>
              <p className="text-body-sm text-ink-muted">Merci ! Votre espace est prêt. Votre facture est disponible dans la page Abonnement.</p>
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
              <p className="text-body-sm text-ink-muted">Aucun abonnement n&apos;a été activé et rien n&apos;a été débité. Vous pouvez réessayer.</p>
            </>
          )}
          {state !== "loading" && state !== "pending" && (
            <Link href="/espace/abonnement" className={buttonVariants({ variant: "primary" })}>
              {state === "paid" ? "Ouvrir mon espace" : "Retour à l'abonnement"}
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
