import { Briefcase, Calculator, Check, Home, UserRound, Users } from "lucide-react";
import { SectionHeading } from "@/components/marketing/section-heading";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ROLES = [
  {
    icon: Briefcase,
    title: "La direction",
    tagline: "Tout piloter, rien perdre de vue.",
    points: [
      "Tableau de bord : loyers encaissés, impayés, plaintes en cours, alertes du jour",
      "Un menu et des droits sur mesure pour chaque employé",
      "Journal d'activité : qui a fait quoi, et quand",
      "Carte du portefeuille et alertes de retard avant qu'il ne survienne",
    ],
  },
  {
    icon: Users,
    title: "Les agents",
    tagline: "Le terrain, sans paperasse.",
    points: [
      "Fiche locataire, bail, paiements et quittances au même endroit",
      "États des lieux par zones, avec photos et facturation des dégradations",
      "Plaintes suivies de l'ouverture à la résolution",
      "Un agent peut être limité aux Biens qui lui sont attribués",
    ],
  },
  {
    icon: Calculator,
    title: "La comptabilité",
    tagline: "Des comptes justes, mois après mois.",
    points: [
      "Journal des dépenses par jour, dépenses à crédit chez un fournisseur",
      "Clôture mensuelle qui verrouille les écritures",
      "Exports Excel et PDF du registre et du rapport mensuel",
      "Module SYSCOHADA optionnel : grand livre, balance, bilan",
    ],
  },
  {
    icon: Home,
    title: "Les propriétaires",
    tagline: "Rassurés, sans vous appeler.",
    points: [
      "Un lien personnel, sans mot de passe, pour consulter leur portail",
      "Recette du mois, commission, part propriétaire et versements",
      "Relevé mensuel PDF et carnet des charges SONEB/SBEE",
      "L'historique complet de leurs versements",
    ],
  },
  {
    icon: UserRound,
    title: "Les locataires",
    tagline: "Autonomes sur leur dossier.",
    points: [
      "Leur frise des 12 mois de loyer : payé, partiel, en retard",
      "Contrat de bail téléchargeable",
      "Leurs factures d'eau et d'électricité restant à régler",
      "Paiement en ligne si le cabinet l'a activé",
    ],
  },
] as const;

export function Roles() {
  return (
    <section id="fonctionnalites" className="bg-surface-muted py-14 sm:py-20">
      <div className="content-shell">
        <SectionHeading
          eyebrow="Pour toute l'équipe"
          title="Chacun trouve exactement ce dont il a besoin"
          description="Une seule plateforme, mais un espace adapté à chaque métier — et à chaque personne que vous servez."
        />
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {ROLES.map(({ icon: Icon, title, tagline, points }) => (
            <Card key={title} className="transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-bg text-primary">
                  <Icon size={20} />
                </div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{tagline}</CardDescription>
                <ul className="mt-3 flex flex-col gap-2">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-body-sm text-ink-soft">
                      <Check size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
