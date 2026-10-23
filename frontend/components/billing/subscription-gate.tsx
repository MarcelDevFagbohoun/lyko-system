"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { fetchSubscription, INACTIVE_EVENT, type Subscription } from "@/lib/api/billing";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Enveloppe de l'espace connecté : si l'abonnement de l'entreprise est expiré (ou clôturé), remplace le contenu par un
 * écran de renouvellement — sauf la page d'abonnement elle-même. Le VRAI blocage est côté serveur (402) ; cet écran
 * n'est que la façon claire de l'expliquer. Avant l'échéance (7 jours), un simple bandeau prévient le DG.
 */
export function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { user, accessToken, status } = useAuth();
  const pathname = usePathname();
  const [sub, setSub] = React.useState<Subscription | null>(null);
  const [blockedByServer, setBlockedByServer] = React.useState(false);
  const isDg = user?.role === "dg";

  React.useEffect(() => {
    if (status !== "authenticated" || !isDg || !accessToken) return;
    fetchSubscription(accessToken).then(setSub).catch(() => {});
  }, [status, isDg, accessToken, pathname]);

  React.useEffect(() => {
    const onInactive = () => setBlockedByServer(true);
    window.addEventListener(INACTIVE_EVENT, onInactive);
    return () => window.removeEventListener(INACTIVE_EVENT, onInactive);
  }, []);

  const onBillingPage = pathname.startsWith("/espace/abonnement");
  const inactive = (sub?.enforced && !sub.active) || blockedByServer;

  if (status === "authenticated" && inactive && !onBillingPage) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertTriangle size={32} className="text-warning-fg" />
            <p className="font-label-md text-ink">L&apos;abonnement de votre entreprise n&apos;est pas actif</p>
            <p className="text-body-sm text-ink-muted">
              {isDg
                ? "L'accès à votre espace est suspendu. Vos locataires peuvent toujours payer leur loyer. Renouvelez votre abonnement pour retrouver l'accès à toutes vos données."
                : "L'accès à l'espace est suspendu. Contactez la direction de votre entreprise pour renouveler l'abonnement."}
            </p>
            {isDg && (
              <Link href="/espace/abonnement" className={buttonVariants({ variant: "primary" })}>
                Voir les offres et renouveler
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const soon = sub?.enforced && sub.active && sub.daysLeft !== null && sub.daysLeft <= 7;
  return (
    <>
      {soon && !onBillingPage && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-b border-warning-border bg-warning-bg px-4 py-2 text-body-sm text-warning-fg">
          <Clock size={14} />
          Votre abonnement se termine {sub!.daysLeft! <= 0 ? "aujourd'hui" : `dans ${sub!.daysLeft} jour${sub!.daysLeft! > 1 ? "s" : ""}`}.
          <Link href="/espace/abonnement" className="font-label-md underline">Renouveler</Link>
        </div>
      )}
      {sub?.enforced && sub.active && sub.overLimits && sub.overLimits.length > 0 && !onBillingPage && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-b border-warning-border bg-warning-bg px-4 py-2 text-body-sm text-warning-fg">
          <Clock size={14} />
          Votre offre a changé : vous dépassez sa limite ({sub.overLimits.map((o) => `${o.count} ${o.label} sur ${o.max}`).join(", ")}). Vous ne pouvez plus en ajouter.
          <Link href="/espace/abonnement" className="font-label-md underline">Changer d&apos;offre</Link>
        </div>
      )}
      {children}
    </>
  );
}
