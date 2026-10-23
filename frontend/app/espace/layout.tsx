"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { EspaceSidebar } from "@/components/espace/espace-sidebar";
import { CardToneProvider } from "@/components/ui/card";
import { SubscriptionGate } from "@/components/billing/subscription-gate";
import { ASSISTANT_ENABLED } from "@/lib/features";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { CADRES, cadreForPath } from "@/lib/module-theme";
import { BrandLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { fetchSubscription } from "@/lib/api/billing";
import { cn } from "@/lib/utils";

/**
 * Coquille commune à tout l'espace connecté (`/espace/**`) : menu vertical
 * fixe + zone de contenu décalée d'autant à partir de `lg` (auparavant, un
 * en-tête horizontal répété individuellement dans chacune des 29 pages —
 * un seul point d'entrée désormais, voir `EspaceSidebar`).
 *
 * Le décalage `lg:pl-sidebar` n'est appliqué qu'une fois authentifié — sinon
 * l'écran de chargement/accès refusé de `RequireAuth` (dans chaque page,
 * centré sur toute la largeur) se retrouverait décalé à droite pendant que
 * `EspaceSidebar` ne rend encore rien.
 *
 * La couleur de fond des cartes et le filet du haut viennent du « cadre » de la page (rubrique du
 * menu — voir `lib/module-theme.ts`).
 *
 * `key={pathname}` sur `<main>` : sans lui, cet élément ne serait monté
 * qu'une fois (il appartient à la coquille, stable entre navigations) et le
 * fondu d'entrée (`animate-page-in`) ne jouerait qu'au premier chargement —
 * la clé force un remontage à chaque changement de page.
 */
export default function EspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user, accessToken, logout } = useAuth();
  const cadre = CADRES[cadreForPath(pathname)];
  // Tant que l'entreprise n'a jamais acheté d'abonnement, aucune partie de l'espace n'est accessible :
  // seul l'écran de choix et de paiement de l'offre s'affiche, sans menu.
  const [firstPlanPending, setFirstPlanPending] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (status !== "authenticated" || !accessToken) return;
    fetchSubscription(accessToken)
      .then((s) => setFirstPlanPending(s.enforced && (s.status === "pending_payment" || s.status === "none")))
      .catch(() => setFirstPlanPending(false));
  }, [status, accessToken, pathname]);

  if (status === "authenticated" && firstPlanPending === null) return <div className="min-h-screen bg-canvas" />;
  if (status === "authenticated" && firstPlanPending) {
    const isDg = user?.role === "dg";
    return (
      <div className="min-h-screen bg-canvas">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 sm:px-8">
          <BrandLogo className="h-9" />
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => { await logout(); router.replace("/connexion"); }}
          >
            <LogOut size={14} /> Se déconnecter
          </Button>
        </header>
        {isDg ? (
          <CardToneProvider tone={cadre.tone}><SubscriptionGate>{children}</SubscriptionGate></CardToneProvider>
        ) : (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-24 text-center">
            <p className="font-label-md text-ink">Votre espace n&apos;est pas encore ouvert</p>
            <p className="text-body-sm text-ink-muted">La direction de votre entreprise doit d&apos;abord choisir et régler une offre. Vous pourrez ensuite vous connecter.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <EspaceSidebar />
      <main key={pathname} className={cn("animate-page-in", status === "authenticated" && "lg:pl-sidebar")}>
        {/* Filet de la couleur du cadre : dit d'un coup d'œil dans quelle rubrique du menu l'on se trouve. */}
        {status === "authenticated" && <div aria-hidden className={cn("h-1 w-full", cadre.solid)} />}
        <CardToneProvider tone={cadre.tone}>
          <SubscriptionGate>{children}</SubscriptionGate>
        </CardToneProvider>
      </main>
      {ASSISTANT_ENABLED && status === "authenticated" && <AssistantWidget />}
    </div>
  );
}
