import { SectionHeading } from "@/components/marketing/section-heading";

const STEPS = [
  { number: "01", title: "Créez votre espace" },
  { number: "02", title: "Ajoutez votre équipe et vos biens" },
  { number: "03", title: "Pilotez au quotidien" },
] as const;

export function HowItWorks() {
  return (
    <section id="comment-ca-marche" className="content-shell py-14 sm:py-20">
      <SectionHeading eyebrow="Démarrer" title="Comment ça marche" />
      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.number} className="flex items-center gap-4 sm:flex-col sm:text-center">
            <span className="font-display text-headline-lg text-primary">{step.number}</span>
            <h3 className="font-display text-headline-sm text-ink">{step.title}</h3>
          </div>
        ))}
      </div>
    </section>
  );
}
