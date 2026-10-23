"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { PENDING_OFFER_KEY } from "@/lib/api/billing";
import { fetchCatalog, type Catalog } from "@/lib/api/billing";
import { PlanCards } from "@/components/billing/plan-cards";

export function TarifsView() {
  const [catalog, setCatalog] = React.useState<Catalog | null>(null);
  const [error, setError] = React.useState(false);
  const router = useRouter();
  const { status } = useAuth();

  // Un visiteur choisit son offre ici, crée son compte, puis la retrouve pré-sélectionnée après sa connexion.
  function choose(plan: string, months: number) {
    if (status === "authenticated") {
      router.push("/espace/abonnement");
      return;
    }
    try {
      localStorage.setItem(PENDING_OFFER_KEY, JSON.stringify({ plan, months }));
    } catch {}
    router.push("/inscription");
  }

  React.useEffect(() => {
    fetchCatalog().then(setCatalog).catch(() => setError(true));
  }, []);

  return (
    <div className="content-shell flex flex-col gap-8 py-12">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-headline-lg text-ink">Des tarifs simples, sans surprise</h1>
        <p className="mt-2 text-body-md text-ink-soft">
          Commencez avec l&apos;offre qui vous convient. Pas de prélèvement automatique : vous renouvelez quand vous le décidez.
        </p>
      </div>
      {error && <p className="text-center text-body-sm text-danger-fg">Impossible de charger les tarifs pour le moment.</p>}
      {catalog && (
        <>
          <PlanCards
            catalog={catalog}
            onChoose={(plan, months) => choose(plan, months)}
          />
          <p className="text-center text-body-sm text-ink-muted">
            Satisfait ou remboursé : demandez le remboursement de votre premier abonnement dans les {catalog.refundWindowDays} jours.
            Les frais du prestataire de paiement sont déduits du montant remboursé. Vous créez votre compte, confirmez votre e-mail, puis payez l&apos;offre choisie.
          </p>
        </>
      )}
    </div>
  );
}
