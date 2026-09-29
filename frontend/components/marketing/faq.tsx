import { ChevronDown } from "lucide-react";
import { SectionHeading } from "@/components/marketing/section-heading";

/** Exporté pour produire aussi les données structurées (FAQPage) de la page d'accueil. */
export const FAQ_ITEMS = [
  {
    question: "Mes données sont-elles visibles par d'autres entreprises ?",
    answer:
      "Non. Chaque entreprise dispose d'un espace cloisonné : ses locataires, ses biens, ses employés et ses chiffres ne sont jamais accessibles aux autres entreprises inscrites.",
  },
  {
    question: "Est-ce que ça fonctionne sans internet ?",
    answer:
      "En partie. Les pages que vous avez déjà ouvertes restent consultables sans réseau, et vous pouvez enregistrer un paiement de loyer ou signaler une plainte hors connexion : ils sont envoyés automatiquement au retour du réseau. La création d'un bien, d'un locataire ou d'un employé demande une connexion.",
  },
  {
    question: "Puis-je limiter ce que voient mes employés ?",
    answer:
      "Oui. Vous choisissez les modules accessibles à chaque employé (locataires, propriétaires, plaintes, comptabilité, charges…) et vous pouvez limiter un agent aux Biens qui lui sont attribués.",
  },
  {
    question: "Comment mes locataires paient-ils ?",
    answer:
      "Vous enregistrez les paiements reçus en espèces, par Mobile Money, virement ou chèque. Si votre entreprise le souhaite, elle peut aussi activer le paiement en ligne (Mobile Money ou carte) via KKiaPay, avec son propre compte marchand.",
  },
  {
    question: "Mes propriétaires ont-ils accès aux informations ?",
    answer:
      "Ils consultent un portail personnel, sans mot de passe, accessible par un lien que vous leur donnez : recette du mois, commission, versements, relevé PDF et carnet des charges. Le portail est en lecture seule.",
  },
  {
    question: "Lyko System règle-t-il les factures SONEB et SBEE ?",
    answer:
      "Non : il les suit. Le propriétaire paie la facture mère ; Lyko calcule les factures de chaque locataire, suit leurs paiements, fait le point avec la facture mère et prépare le reversement des charges encaissées.",
  },
  {
    question: "La comptabilité SYSCOHADA est-elle obligatoire ?",
    answer:
      "Non. La comptabilité simple (recettes, dépenses, clôture mensuelle, exports) est toujours disponible. Le module SYSCOHADA est optionnel : la direction l'active depuis les Réglages quand elle en a besoin.",
  },
  {
    question: "Et si un employé se trompe dans une saisie ?",
    answer:
      "Un paiement mal saisi peut être annulé, et l'annulation reste tracée. Un paiement envoyé deux fois par erreur ne s'enregistre qu'une seule fois. Une fois un mois clôturé, plus rien ne peut y être modifié.",
  },
  {
    question: "Peut-on l'utiliser sur téléphone ?",
    answer:
      "Oui. L'interface s'adapte aux écrans de téléphone et de tablette, et l'application peut être installée sur l'écran d'accueil comme une application.",
  },
  {
    question: "Comment démarrer ?",
    answer:
      "Créez le compte de votre entreprise en quelques minutes, ajoutez vos employés puis vos biens et vos locataires. Votre compte est créé avec le rôle Admin et tous les droits.",
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
