"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { PENDING_OFFER_KEY } from "@/lib/api/billing";
import { fetchCatalog, FEATURE_LABELS, type Catalog } from "@/lib/api/billing";
import { PlanCards } from "@/components/billing/plan-cards";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const TRIAL_FEATURES = ["core", "payroll", "owner_portal", "sale_properties", "audit_full"];

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

  // L'essai gratuit n'a rien à choisir : il est accordé automatiquement dès la création du compte.
  function startTrial() {
    if (status === "authenticated") {
      router.push("/espace/abonnement");
      return;
    }
    router.push("/inscription");
  }

  React.useEffect(() => {
    fetchCatalog().then(setCatalog).catch(() => setError(true));
  }, []);

  const trial = catalog?.freeTrial;
  const hasPaidPlans = (catalog?.plans.length ?? 0) > 0;

  return (
    <div className="content-shell flex flex-col gap-8 py-12">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-headline-lg text-ink">Des tarifs simples, sans surprise</h1>
        <p className="mt-2 text-body-md text-ink-soft">
          {trial?.enabled
            ? "Commencez par un mois d'essai gratuit, avec toutes les fonctionnalités. Pas de carte bancaire requise."
            : "Commencez avec l'offre qui vous convient. Pas de prélèvement automatique : vous renouvelez quand vous le décidez."}
        </p>
      </div>
      {error && <p className="text-center text-body-sm text-danger-fg">Impossible de charger les tarifs pour le moment.</p>}
      {catalog && trial?.enabled && (
        <Card className="mx-auto w-full max-w-2xl border-primary ring-1 ring-primary">
          <CardContent className="flex flex-col gap-4 py-6 text-center">
            <h2 className="font-display text-headline-md text-ink">{trial.label} — 1 mois, toutes les fonctionnalités</h2>
            <p className="text-body-sm text-ink-soft">
              Essayez {trial.label.toLowerCase()} sans engagement ni paiement. À la fin du mois, vous pourrez passer à une offre payante pour continuer.
            </p>
            <ul className="mx-auto flex flex-col gap-1.5 text-left text-body-sm text-ink-soft">
              {TRIAL_FEATURES.filter((k) => trial.features.includes(k)).map((k) => (
                <li key={k} className="flex gap-2"><Check size={14} className="mt-1 shrink-0 text-success-fg" />{FEATURE_LABELS[k]}</li>
              ))}
            </ul>
            <Button className="self-center" onClick={startTrial}>Commencer mon essai gratuit</Button>
          </CardContent>
        </Card>
      )}
      {catalog && hasPaidPlans && (
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
