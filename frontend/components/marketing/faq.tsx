import { ChevronDown } from "lucide-react";
import { SectionHeading } from "@/components/marketing/section-heading";

/** Exporté pour produire aussi les données structurées (FAQPage) de la page d'accueil. */
export const FAQ_ITEMS = [
  {
    question: "Est-ce que ça fonctionne sans internet ?",
    answer:
      "Oui pour l'essentiel : les pages déjà ouvertes restent consultables, et vous pouvez enregistrer un paiement de loyer hors connexion. Il est envoyé automatiquement au retour du réseau.",
  },
  {
    question: "Puis-je limiter ce que voient mes employés ?",
    answer:
      "Oui, totalement. Vous choisissez les modules accessibles à chaque employé (locataires, propriétaires, plaintes, comptabilité, charges…) et vous pouvez limiter un agent aux Biens qui lui sont attribués.",
  },
  {
    question: "Comment mes locataires paient-ils ?",
    answer:
      "Vous enregistrez les paiements reçus en espèces, par Mobile Money, virement ou chèque. Si votre entreprise le souhaite, elle peut aussi activer le paiement en ligne (Mobile Money ou carte) via FedaPay, avec son propre compte marchand.",
  },
  {
    question: "Mes propriétaires ont-ils accès aux informations ?",
    answer:
      "Ils consultent un portail personnel, sans mot de passe, accessible par un lien que vous leur donnez : recette du mois, commission, versements et relevé PDF. Le portail est en lecture seule.",
  },
  {
    question: "La comptabilité SYSCOHADA est-elle obligatoire ?",
    answer:
      "Non. La comptabilité simple (recettes, dépenses, clôture mensuelle, exports) est toujours disponible. Le module SYSCOHADA est optionnel : la direction l'active depuis les Réglages quand elle en a besoin.",
  },
  {
    question: "Et si un employé se trompe dans une saisie ?",
    answer:
      "Rien de grave : un paiement mal saisi s'annule, et tout reste tracé. Un paiement envoyé deux fois par erreur ne s'enregistre qu'une seule fois. Une fois un mois clôturé, plus rien ne peut y être modifié.",
  },
  {
    question: "Peut-on l'utiliser sur téléphone ?",
    answer:
      "Oui. L'interface s'adapte aux écrans de téléphone et de tablette, et l'application peut être installée sur l'écran d'accueil comme une application.",
  },
  {
    question: "Combien ça coûte ?",
    answer:
      "Trois offres selon la taille de votre portefeuille : une offre d'entrée pour démarrer, une offre pensée pour la majorité des cabinets, et une offre pour les plus grandes structures. Le détail est sur notre page Tarifs, accessible depuis le menu.",
  },
  {
    question: "Comment démarrer ?",
    answer:
      "Créez le compte de votre entreprise en quelques minutes, choisissez votre offre, puis ajoutez vos employés, vos biens et vos locataires. Vous êtes satisfait ou remboursé pendant 15 jours.",
  },
] as const;

export function Faq() {
  return (
    <section id="questions" className="bg-surface-muted py-14 sm:py-20">
      <div className="content-shell">
        <SectionHeading eyebrow="Questions fréquentes" title="Ce que l'on nous demande le plus souvent" />
        <div className="mx-auto mt-10 flex max-w-3xl flex-col gap-3">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group rounded-lg border border-border bg-surface shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 font-label-md text-ink [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown size={18} className="shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="px-4 pb-4 text-body-md text-ink-soft">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
