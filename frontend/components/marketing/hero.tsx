import Link from "next/link";
import { ShieldCheck, WifiOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { formatFcfa } from "@/lib/utils";

export function Hero() {
  return (
    <section className="content-shell grid grid-cols-1 items-center gap-10 py-14 sm:py-20 lg:grid-cols-2 lg:gap-16">
      <div className="flex flex-col gap-6">
        <Badge variant="info" className="w-fit">
          Gestion locative & juridique
        </Badge>

        <h1 className="font-display text-headline-2xl text-ink sm:text-[2.75rem] sm:leading-[1.1]">
          Toute la gestion de votre entreprise, dans un seul espace sécurisé.
        </h1>

        <p className="max-w-xl text-body-lg text-ink-soft">
          Lyko System réunit vos locataires, propriétaires, contrats, paiements,
          réclamations, comptabilité et charges au même endroit, avec des rôles
          précis pour chaque employé et un fonctionnement qui résiste aux coupures
          de connexion.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/inscription" className={buttonVariants({ variant: "primary", size: "lg" })}>
            Créer mon compte
          </Link>
          <Link href="/connexion" className={buttonVariants({ variant: "secondary", size: "lg" })}>
            Se connecter
          </Link>
        </div>

        <div className="flex flex-col gap-2 pt-2 text-body-sm text-ink-muted sm:flex-row sm:items-center sm:gap-6">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={16} className="text-primary" />
            Espace cloisonné par entreprise
          </span>
          <span className="inline-flex items-center gap-1.5">
            <WifiOff size={16} className="text-primary" />
            Fonctionne même hors connexion
          </span>
        </div>
      </div>

      {/* Aperçu produit — composants réels de la charte, pas une capture fictive */}
      <Card className="p-4 shadow-lg sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-label-sm uppercase tracking-wider text-ink-muted">Tableau de bord DG</p>
            <p className="font-display text-headline-sm text-ink">Vue du jour</p>
          </div>
          <Badge variant="success" dot>
            Synchronisé
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Loyers recouvrés"
            value={formatFcfa(18_450_000, { withSuffix: false })}
            unit="FCFA"
            trend={{ value: "+8,5 %", direction: "up" }}
          />
          <StatCard
            label="Impayés"
            tone="danger"
            value={formatFcfa(2_350_000, { withSuffix: false })}
            unit="FCFA"
            trend={{ value: "12 dossiers", direction: "down" }}
          />
        </div>

        <div className="mt-3 flex flex-col divide-y divide-border rounded-lg border border-border">
          <div className="flex items-center justify-between px-3 py-2.5">
            <div>
              <p className="font-label-md text-ink">Mme Viviane AGBOTON</p>
              <p className="text-body-xs text-ink-muted">Appt 3B, Palmiers</p>
            </div>
            <Badge variant="success" dot>
              Payé
            </Badge>
          </div>
          <div className="flex items-center justify-between px-3 py-2.5">
            <div>
              <p className="font-label-md text-ink">Pascal HOUNKPONOU</p>
              <p className="text-body-xs text-ink-muted">Lot 4, Rés. Palmiers</p>
            </div>
            <Badge variant="danger" dot>
              Retard 18 j
            </Badge>
          </div>
          <div className="flex items-center justify-between px-3 py-2.5">
            <div>
              <p className="font-label-md text-ink">Facture SBEE, Haie Vive</p>
              <p className="text-body-xs text-ink-muted">Échéance demain</p>
            </div>
            <Badge variant="warning" dot>
              En attente
            </Badge>
          </div>
        </div>
      </Card>
    </section>
  );
}
