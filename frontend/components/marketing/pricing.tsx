"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { fetchCatalog, PENDING_OFFER_KEY, type Catalog } from "@/lib/api/billing";
import { PlanCards } from "@/components/billing/plan-cards";
import { SectionHeading } from "@/components/marketing/section-heading";

/** Tarifs sur la page d'accueil (2e bloc) : prix lus sur le serveur, jamais écrits en dur. */
export function Pricing() {
  const [catalog, setCatalog] = React.useState<Catalog | null>(null);
  const router = useRouter();
  const { status } = useAuth();

  React.useEffect(() => {
    fetchCatalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);

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

  return (
    <section id="tarifs" className="scroll-mt-20 bg-surface py-14 sm:py-20">
      <div className="content-shell">
        <SectionHeading
          eyebrow="Tarifs"
          title="Des tarifs simples, sans surprise"
          description="Choisissez l'offre qui correspond à votre portefeuille. Aucun prélèvement automatique : vous renouvelez quand vous le décidez."
        />
        <div className="mt-10">
          {catalog ? (
            <PlanCards catalog={catalog} onChoose={(plan, months) => choose(plan, months)} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-3" aria-hidden>
              {[0, 1, 2].map((i) => <div key={i} className="h-80 animate-pulse rounded-lg bg-surface-muted" />)}
            </div>
          )}
        </div>
        <p className="mx-auto mt-6 flex max-w-2xl items-center justify-center gap-2 text-center text-body-sm text-ink-muted">
          <ShieldCheck size={16} className="shrink-0 text-primary" aria-hidden />
          Satisfait ou remboursé pendant {catalog?.refundWindowDays ?? 15} jours sur votre premier abonnement.
        </p>
      </div>
    </section>
  );
}
