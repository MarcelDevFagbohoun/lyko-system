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
      "Créez les comptes agent et comptable avec des permissions précises, puis constituez votre parc locatif.",
  },
  {
    number: "03",
    title: "Pilotez au quotidien",
    description:
      "Encaissements, relances, réclamations et rapports mensuels, même hors connexion, avec synchronisation automatique.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="comment-ca-marche" className="bg-surface-muted py-14 sm:py-20">
      <div className="content-shell">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-headline-xl text-ink">Comment ça marche</h2>
          <p className="mt-3 text-body-lg text-ink-soft">
            Trois étapes pour digitaliser la gestion de votre entreprise.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.number} className="flex flex-col gap-2">
              <span className="font-display text-headline-lg text-primary">{step.number}</span>
              <h3 className="font-display text-headline-sm text-ink">{step.title}</h3>
              <p className="text-body-md text-ink-soft">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
