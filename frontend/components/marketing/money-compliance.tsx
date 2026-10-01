import { Banknote, BookOpenCheck, CalendarCheck, FileText, Landmark, Lock, Percent, Receipt, Wallet } from "lucide-react";
import { SectionHeading } from "@/components/marketing/section-heading";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ITEMS = [
  {
    icon: Receipt,
    title: "Quittances et contrats",
    description: "Documents PDF numérotés, générés à chaque paiement, avec un code qui permet de vérifier qu'ils sont authentiques.",
  },
  {
    icon: CalendarCheck,
    title: "Loyer d'avance ou à terme échu",
    description: "Chaque bail suit sa convention. Le reste d'un mois payé en partie se règle sans erreur de calcul.",
  },
  {
    icon: Landmark,
    title: "Séquestre par propriétaire",
    description: "Vous savez toujours combien l'entreprise détient pour chacun, et un versement ne peut pas dépasser ce solde.",
  },
  {
    icon: Percent,
    title: "Commission sur mesure",
    description: "Un taux par propriétaire, avec des dates d'effet : la part de l'entreprise et celle du propriétaire se calculent seules.",
  },
  {
    icon: Wallet,
    title: "Dépenses et fournisseurs",
    description: "Journal par jour, dépenses rattachées à un Bien, achats à crédit chez un fournisseur, immobilisations et amortissements.",
  },
  {
    icon: Lock,
    title: "Clôture mensuelle",
    description: "Une fois le mois clos, plus rien ne peut y être ajouté, modifié ou supprimé — même par erreur.",
  },
  {
    icon: BookOpenCheck,
    title: "Comptabilité SYSCOHADA (option)",
    description: "Écritures générées automatiquement, grand livre, balance, bilan, compte de résultat, flux de trésorerie, rapprochement bancaire.",
  },
  {
    icon: FileText,
    title: "Exports et rapports",
    description: "Registre en Excel, rapport mensuel en PDF, relevé propriétaire, états financiers : prêts pour votre expert-comptable.",
  },
] as const;

export function MoneyCompliance() {
  return (
    <section id="argent" className="bg-surface-muted py-14 sm:py-20">
      <div className="content-shell">
        <SectionHeading
          eyebrow="L'argent de l'entreprise"
          title="Des comptes justes, du premier paiement à la clôture"
          description="Chaque franc encaissé est rattaché à un locataire, un Bien, un propriétaire — et reste traçable."
        />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-bg text-primary">
                  <Icon size={20} />
                </div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
        <p className="mx-auto mt-6 flex max-w-2xl items-center justify-center gap-2 text-center text-body-sm text-ink-muted">
          <Banknote size={16} className="shrink-0" aria-hidden />
          La comptabilité SYSCOHADA est un module optionnel, activé par la direction depuis les Réglages.
        </p>
      </div>
    </section>
  );
}
