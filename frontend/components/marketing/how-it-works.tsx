import { SectionHeading } from "@/components/marketing/section-heading";

const STEPS = [
  {
    number: "01",
    title: "Créez l'espace de votre entreprise",
    description:
      "Renseignez votre entreprise (RCCM, IFU) et votre logo. Votre compte est créé avec le rôle Admin et tous les droits.",
  },
  {
    number: "02",
    title: "Ajoutez employés, biens et locataires",
    description:
      "Créez les comptes agent et comptable avec des permissions précises, puis constituez votre parc : propriétaires, biens, unités, baux.",
  },
  {
    number: "03",
    title: "Pilotez au quotidien",
    description:
      "Encaissements, relances, plaintes, charges et rapports mensuels — pendant que vos propriétaires et vos locataires se servent seuls sur leur portail.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="comment-ca-marche" className="content-shell py-14 sm:py-20">
      <SectionHeading eyebrow="Démarrer" title="Comment ça marche" description="Trois étapes pour digitaliser la gestion de votre entreprise." />
      <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.number} className="flex flex-col gap-2">
            <span className="font-display text-headline-lg text-primary">{step.number}</span>
            <h3 className="font-display text-headline-sm text-ink">{step.title}</h3>
            <p className="text-body-md text-ink-soft">{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
