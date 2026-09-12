import { Users, Building2, Wallet, Flag, Droplet, WifiOff } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const FEATURES = [
  {
    icon: Users,
    title: "Gestion des locataires",
    description:
      "Fiche complète, quittances, lettres, relances, états des lieux d'entrée/sortie et suivi de la caution.",
  },
  {
    icon: Building2,
    title: "Gestion des propriétaires",
    description:
      "Biens liés à chaque propriétaire, relevés mensuels officiels et historique complet des versements.",
  },
  {
    icon: Wallet,
    title: "Comptabilité & trésorerie",
    description:
      "Recettes et dépenses du jour, bilan mensuel, rapprochement bancaire et exports Excel/PDF.",
  },
  {
    icon: Flag,
    title: "Plaintes & réclamations",
    description:
      "Suivi du signalement à la résolution (ouverte → en cours → résolue), avec délais et relances.",
  },
  {
    icon: Droplet,
    title: "Charges & redevances",
    description:
      "Factures SONEB, SBEE et ordures suivies par compteur ou par maison, avec alertes d'échéance.",
  },
  {
    icon: WifiOff,
    title: "Mode hors-ligne",
    description:
      "Saisie possible sans connexion (paiement, dépense, fiche locataire) ; synchronisation automatique au retour du réseau.",
  },
] as const;

export function FeatureGrid() {
  return (
    <section id="fonctionnalites" className="content-shell py-14 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-headline-xl text-ink">
          Un module pour chaque métier de l&apos;entreprise
        </h2>
        <p className="mt-3 text-body-lg text-ink-soft">
          Chaque module partage les mêmes composants, les mêmes couleurs de statut et
          les mêmes règles d&apos;accès par rôle.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <Card key={title} className="transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted text-primary">
                <Icon size={20} />
              </div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}
