import Link from "next/link";
import { BadgeCheck, Smartphone } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { formatFcfa, cn } from "@/lib/utils";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-primary-bg via-canvas to-canvas">
      <span aria-hidden className="animate-float-slow pointer-events-none absolute -right-24 top-10 hidden h-80 w-80 rounded-full bg-primary/15 blur-3xl lg:block" />
      <span aria-hidden className="animate-float-slow pointer-events-none absolute -left-16 bottom-0 hidden h-56 w-56 rounded-full bg-info/15 blur-3xl lg:block [animation-delay:-4s]" />

      <div className="content-shell relative grid grid-cols-1 items-center gap-12 py-14 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-6">
          <Badge variant="primary" className="animate-fade-up w-fit">
            Gestion locative · Bénin
          </Badge>
          <h1 className="animate-fade-up font-display text-headline-2xl text-ink [animation-delay:60ms] sm:text-[2.9rem] sm:leading-[1.08]">
            Encaissez vos loyers à temps. <span className="text-primary">Rendez des comptes justes</span> à vos propriétaires.
          </h1>
          <p className="animate-fade-up max-w-xl text-body-lg text-ink-soft [animation-delay:120ms]">
            Un seul espace pour toute votre équipe, pour gagner du temps et rassurer vos propriétaires.
          </p>
          <div className="animate-fade-up flex flex-col gap-3 [animation-delay:180ms] sm:flex-row">
            <Link href="/inscription" className={cn(buttonVariants({ variant: "primary", size: "lg" }), "transition-transform hover:-translate-y-0.5")}>
              Créer mon compte
            </Link>
            <a href="#tarifs" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "transition-transform hover:-translate-y-0.5")}>
              Voir les tarifs
            </a>
          </div>
          <ul className="animate-fade-up flex flex-col gap-2 pt-2 text-body-sm text-ink-muted [animation-delay:240ms] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
            <li className="inline-flex items-center gap-1.5"><BadgeCheck size={16} className="text-primary" />Satisfait ou remboursé 15 jours</li>
            <li className="inline-flex items-center gap-1.5"><Smartphone size={16} className="text-primary" />Ordinateur, tablette et téléphone</li>
          </ul>
        </div>

        {/* Photo + aperçu du tableau de bord (composants réels de la charte). `<img>` simple : l'optimiseur Next est désactivé. */}
        <div className="animate-fade-up relative mx-auto w-full max-w-lg [animation-delay:160ms] lg:max-w-none">
          <div className="overflow-hidden rounded-2xl shadow-xl ring-1 ring-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/hero.webp"
              srcSet="/img/hero-480.webp 480w, /img/hero.webp 735w"
              sizes="(min-width: 1024px) 560px, 90vw"
              width={735}
              height={860}
              alt="Une équipe souriante gère ses biens avec Africa Immo Management"
              fetchPriority="high"
              className="aspect-[4/4.6] w-full object-cover object-top sm:aspect-[4/3.8]"
            />
          </div>
          <Card className="absolute -bottom-8 left-3 right-3 p-4 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:left-[-1.5rem] sm:right-auto sm:w-[27rem]">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-label-sm uppercase tracking-wider text-ink-muted">Vue du jour</p>
              <Badge variant="neutral">Aperçu</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Loyers recouvrés" value={formatFcfa(18_450_000, { withSuffix: false })} unit="FCFA" trend={{ value: "+8,5 %", direction: "up" }} />
              <StatCard label="Impayés" tone="danger" value={formatFcfa(2_350_000, { withSuffix: false })} unit="FCFA" trend={{ value: "12 dossiers", direction: "down" }} />
            </div>
          </Card>
        </div>
      </div>
      <div className="h-8 lg:h-4" />
    </section>
  );
}
