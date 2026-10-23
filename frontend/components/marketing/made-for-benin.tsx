import { Banknote, Droplets, MessageCircle, Scale, Smartphone } from "lucide-react";
import { SectionHeading } from "@/components/marketing/section-heading";

/**
 * Chaque ligne correspond à une fonction réellement construite (voir docs/AVANCEMENT.md) :
 * rien ici ne promet ce qui n'existe pas.
 */
const ITEMS = [
  { icon: Banknote, title: "Tout en FCFA", text: "Montants entiers et numéros de téléphone béninois contrôlés : pas d'erreur de saisie." },
  { icon: Droplets, title: "Eau & électricité", text: "Relevés de compteurs et suivi des charges d'eau et d'électricité, logement par logement." },
  { icon: Smartphone, title: "Mobile Money & carte", text: "Paiement en ligne optionnel via FedaPay, activé par chaque entreprise avec son propre compte." },
  { icon: MessageCircle, title: "WhatsApp au quotidien", text: "Relances de loyer et de charges, quittances : un message prêt à envoyer, en un clic." },
  { icon: Scale, title: "Plan SYSCOHADA", text: "Comptabilité générale sur le plan SYSCOHADA, en option, à côté de la comptabilité simple." },
] as const;

export function MadeForBenin() {
  return (
    <section id="benin" className="bg-primary py-14 sm:py-20">
      <div className="content-shell">
        <SectionHeading
          inverse
          eyebrow="Conçu pour le Bénin"
          title="Pensé pour la façon dont vous travaillez ici"
          description="Les réalités locales sont au cœur du produit : FCFA, Mobile Money, WhatsApp, SYSCOHADA."
        />
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {ITEMS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex flex-col gap-2 rounded-lg border border-white/15 bg-white/10 p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-white">
                <Icon size={18} />
              </span>
              <h3 className="font-display text-headline-sm text-white">{title}</h3>
              <p className="text-body-sm text-white/80">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
