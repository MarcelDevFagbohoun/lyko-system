import { Calculator, Home, MessageCircle, ShieldCheck, Smartphone, Users } from "lucide-react";
import { SectionHeading } from "@/components/marketing/section-heading";

/** Aperçu volontairement bref : l'essentiel de la promesse, sans détail des fonctions (le détail se découvre dans le produit). */
const ITEMS = [
  { icon: Users, title: "Toute l'équipe", text: "Un espace adapté à chaque métier." },
  { icon: Home, title: "Propriétaires et locataires", text: "Un portail simple pour chacun." },
  { icon: MessageCircle, title: "Relances WhatsApp", text: "Un message prêt, en un clic." },
  { icon: Calculator, title: "Comptabilité", text: "Des comptes justes, toujours à jour." },
  { icon: Smartphone, title: "Paiement en ligne", text: "Mobile Money et carte, en option." },
  { icon: ShieldCheck, title: "Sécurité", text: "Accès contrôlés et actions tracées." },
] as const;

export function Features() {
  return (
    <section id="fonctionnalites" className="scroll-mt-20 bg-surface-muted py-14 sm:py-20">
      <div className="content-shell">
        <SectionHeading eyebrow="Fonctionnalités" title="L'essentiel pour gérer vos biens" description="Pensé pour la façon de travailler au Bénin." />
        <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {ITEMS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 sm:p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-bg text-primary">
                <Icon size={20} />
              </span>
              <h3 className="font-display text-headline-sm text-ink">{title}</h3>
              <p className="text-body-sm text-ink-soft">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
