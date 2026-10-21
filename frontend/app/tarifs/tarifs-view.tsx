"use client";

import * as React from "react";
import Link from "next/link";
import { fetchCatalog, type Catalog } from "@/lib/api/billing";
import { PlanCards } from "@/components/billing/plan-cards";
import { buttonVariants } from "@/components/ui/button";

export function TarifsView() {
  const [catalog, setCatalog] = React.useState<Catalog | null>(null);
  const [error, setError] = React.useState(false);

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
            footer={() => (
              <Link href="/inscription" className={buttonVariants({ variant: "primary" })}>
                Créer mon compte
              </Link>
            )}
          />
          <p className="text-center text-body-sm text-ink-muted">
            Satisfait ou remboursé : demandez le remboursement de votre premier abonnement dans les {catalog.refundWindowDays} jours.
            Les frais du prestataire de paiement sont déduits du montant remboursé. Vous choisissez et payez votre offre juste après avoir créé votre compte.
          </p>
        </>
      )}
    </div>
  );
}
