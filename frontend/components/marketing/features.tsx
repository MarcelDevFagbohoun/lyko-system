import { Calculator, Home, MessageCircle, ShieldCheck, Smartphone, Users } from "lucide-react";
import { SectionHeading } from "@/components/marketing/section-heading";
import { Reveal } from "@/components/marketing/reveal";

/**
 * Promesses concrètes avec un détail vérifiable chacune (demande utilisateur,
 * 2026-11-04 : des cartes plus détaillées, qui donnent vraiment envie) —
 * jamais de chiffre ou de témoignage inventé, uniquement ce que le produit
 * fait réellement aujourd'hui.
 */
const ITEMS = [
  {
    icon: Users,
    title: "Une équipe alignée",
    text: "DG, comptable, agent : chacun son espace et ses accès, sans tout voir ni tout casser. Chaque action reste tracée au nom de son auteur.",
  },
  {
    icon: Home,
    title: "Des clients rassurés",
    text: "Un lien privé pour chaque propriétaire : loyers encaissés, reversements et soldes à jour. Le locataire reçoit son reçu automatiquement après paiement.",
  },
  {
    icon: MessageCircle,
    title: "Zéro relance oubliée",
    text: "Le logiciel repère lui-même les loyers en retard et envoie le rappel par WhatsApp, sans que vous ayez à y penser.",
  },
  {
    icon: Calculator,
    title: "Charges sans prise de tête",
    text: "Numéro de compteur SONEB et SBEE par logement : charges suivies et refacturées automatiquement, bail par bail, chaque mois.",
  },
  {
    icon: Smartphone,
    title: "Partout avec vous",
    text: "Pensé pour le téléphone autant que pour l'ordinateur : ouvrez un dossier sur le terrain, aussi vite qu'au bureau.",
  },
  {
    icon: ShieldCheck,
    title: "Tout sous contrôle",
    text: "Chaque encaissement génère un reçu, chaque mouvement est horodaté et attribué — retrouvable en quelques secondes, même des mois plus tard.",
  },
] as const;

export function Features() {
  return (
    <section id="fonctionnalites" className="relative scroll-mt-20 overflow-hidden bg-gradient-to-b from-surface-muted to-canvas py-14 sm:py-20">
      <span aria-hidden className="motion-safe:animate-float-slow pointer-events-none absolute -left-20 top-20 hidden h-64 w-64 rounded-full bg-primary/10 blur-3xl lg:block" />
      <span aria-hidden className="motion-safe:animate-float-slow pointer-events-none absolute -right-20 bottom-10 hidden h-64 w-64 rounded-full bg-info/10 blur-3xl [animation-delay:-5s] lg:block" />
      <div className="content-shell relative">
        <SectionHeading eyebrow="La solution" title="Tout ça, un seul logiciel le fait pour vous" description="Pensé pour le Bénin, dès le premier jour : FCFA, Mobile Money, SONEB, SBEE, WhatsApp." />
        <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
          {ITEMS.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 80}>
              <div className="group relative h-full overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40 hover:shadow-xl sm:p-6">
                <span aria-hidden className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-primary to-info transition-transform duration-500 group-hover:scale-x-100" />
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-bg text-primary transition-all duration-300 group-hover:rotate-6 group-hover:scale-110 group-hover:bg-primary group-hover:text-white sm:h-12 sm:w-12">
                  <Icon size={22} />
                </span>
                <h3 className="mt-3 font-display text-headline-sm text-ink sm:mt-4">{title}</h3>
                <p className="mt-1 text-body-sm text-ink-soft">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
