import { SectionHeading } from "@/components/marketing/section-heading";
import { Reveal } from "@/components/marketing/reveal";

const STEPS = [
  { number: "1", title: "Créez votre espace", text: "En quelques minutes." },
  { number: "2", title: "Installez votre équipe", text: "Biens, équipe, locataires." },
  { number: "3", title: "Pilotez et encaissez", text: "Tout depuis un seul endroit." },
] as const;

export function HowItWorks() {
  return (
    <section id="comment-ca-marche" className="content-shell py-14 sm:py-20">
      <SectionHeading eyebrow="Démarrer" title="Prêt en 3 étapes" />
      <div className="relative mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3">
        <span aria-hidden className="absolute left-[16%] right-[16%] top-7 hidden h-0.5 bg-gradient-to-r from-primary/20 via-primary to-primary/20 sm:block" />
        {STEPS.map((step, i) => (
          <Reveal key={step.number} delay={i * 120}>
            <div className="group relative flex items-center gap-4 sm:flex-col sm:text-center">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary font-display text-headline-md text-white shadow-lg ring-4 ring-canvas transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                {step.number}
              </span>
              <div>
                <h3 className="font-display text-headline-sm text-ink">{step.title}</h3>
                <p className="text-body-sm text-ink-soft">{step.text}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
