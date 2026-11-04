import { FileX2, MessagesSquare, CalendarClock, Receipt } from "lucide-react";
import { SectionHeading } from "@/components/marketing/section-heading";
import { Reveal } from "@/components/marketing/reveal";

/**
 * Section "problème" placée juste après le héros, avant les fonctionnalités (demande utilisateur,
 * 2026-11-04 : rendre la page d'accueil plus marketing) : nommer les frictions concrètes et reconnaissables
 * d'un cabinet immobilier au Bénin AVANT de présenter la solution, pour que le visiteur se reconnaisse
 * tout de suite. Volontairement sans statistique ni chiffre inventé — uniquement des situations vécues.
 */
const PAINS = [
  { icon: FileX2, text: "Des cahiers, des fichiers Excel et des reçus manuscrits qui se perdent" },
  { icon: MessagesSquare, text: "Des locataires et propriétaires qui appellent pour savoir où en est leur dossier" },
  { icon: CalendarClock, text: "Des loyers en retard qu'on découvre trop tard, faute de relance" },
  { icon: Receipt, text: "Des charges SONEB/SBEE recalculées à la main, bail par bail, chaque mois" },
] as const;

export function PainPoints() {
  return (
    <section className="content-shell py-10 sm:py-14">
      <SectionHeading
        eyebrow="Le quotidien, sans logiciel"
        title="Vous reconnaissez ça ?"
        description="C'est le lot de beaucoup d'entreprises et d'agences de gestion locative au Bénin — ça ne devrait pas l'être."
      />
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        {PAINS.map(({ icon: Icon, text }, i) => (
          <Reveal key={text} delay={i * 80}>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger-bg text-danger-fg">
                <Icon size={18} />
              </span>
              <p className="text-body-sm text-ink-soft">{text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
