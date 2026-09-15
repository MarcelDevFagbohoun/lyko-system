"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  Handshake,
  ShieldCheck,
  MessageSquareText,
  ClipboardCheck,
  KeyRound,
  FileEdit,
  PhoneCall,
  BadgeCheck,
  ArrowRight,
  Home as HomeGlyph,
  CheckCircle2,
} from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { getPublicMarketplace, type PublicMarketplace } from "@/lib/api/marketplace";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { ListingCard } from "@/components/listing-card";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

const VALUE_PROPS = [
  {
    icon: ShieldCheck,
    title: "Des biens vérifiés",
    text: "Chaque annonce est gérée par une agence partenaire, suivie via Lyko System — jamais un particulier anonyme.",
    accent: "success" as const,
  },
  {
    icon: Handshake,
    title: "Un accompagnement complet",
    text: "De la mise en location à la gestion quotidienne, nos agences partenaires s'occupent de tout pour vous.",
    accent: "primary" as const,
  },
  {
    icon: BadgeCheck,
    title: "Une gestion sérieuse",
    text: "Chaque agence partenaire suit ses biens grâce à Lyko System, la plateforme de gestion locative.",
    accent: "info" as const,
  },
];

const VALUE_ACCENT_CLASSES = {
  success: { bar: "bg-success", glow: "bg-success/15", icon: "text-success-fg" },
  primary: { bar: "bg-primary", glow: "bg-primary/15", icon: "text-primary" },
  info: { bar: "bg-info", glow: "bg-info/15", icon: "text-info-fg" },
};

const RENTER_STEPS = [
  { icon: Search, title: "Parcourez les annonces", text: "Filtrez les biens disponibles selon vos besoins." },
  { icon: MessageSquareText, title: "Contactez l'agence", text: "Un message WhatsApp suffit pour organiser une visite." },
  { icon: KeyRound, title: "Visitez et signez", text: "L'agence partenaire vous accompagne jusqu'à la remise des clés." },
];

const OWNER_STEPS = [
  { icon: FileEdit, title: "Confiez votre bien", text: "Décrivez votre bien : à louer, ou à vendre." },
  { icon: PhoneCall, title: "Une agence vous contacte", text: "Une agence partenaire étudie votre demande et vous appelle." },
  { icon: ClipboardCheck, title: "C'est géré", text: "Location ou vente, tout est pris en charge pour vous." },
];

export default function HomePage() {
  const [data, setData] = React.useState<PublicMarketplace | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getPublicMarketplace()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : null));
  }, []);

  const featured = data?.listings.slice(0, 3) ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />

      {/* Hero — fond en dégradé CSS pur, aucune image (léger, net à toute résolution). */}
      <section className="hero-mesh relative overflow-hidden border-b border-border">
        <div
          className="hero-orb pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
          aria-hidden
        />
        <div
          className="hero-orb pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-info/10 blur-3xl"
          aria-hidden
        />
        <div className="content-shell relative grid grid-cols-1 items-center gap-12 py-20 sm:py-28 lg:grid-cols-2 lg:gap-8">
          <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-border bg-surface/80 px-3 py-1 text-body-xs font-label-md text-primary">
              <BadgeCheck size={14} />
              La plateforme reliée à des agences immobilières partenaires
            </span>
            <h1 className="max-w-2xl font-display text-headline-2xl text-ink">
              Trouvez, louez ou vendez votre bien en toute confiance
            </h1>
            <p className="max-w-xl text-body-lg text-ink-soft">
              Quick Immo n&apos;est pas une agence : c&apos;est la plateforme qui réunit les biens de nos agences
              partenaires, et met en relation directe les propriétaires souhaitant louer, vendre ou confier leur
              bien.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/marketplace" className={buttonVariants({ variant: "primary", size: "lg" })}>
                Voir les annonces
                <ArrowRight size={16} />
              </Link>
              <Link href="/confier-un-bien" className={buttonVariants({ variant: "secondary", size: "lg" })}>
                Confier un bien
              </Link>
            </div>
          </div>
          <HeroVisual />
        </div>
      </section>

      <main className="flex-1">
        {/* Comment ça marche — deux publics, trois étapes chacun. */}
        <section className="content-shell flex flex-col gap-10 py-16">
          <div className="text-center">
            <h2 className="font-display text-headline-lg text-ink">Comment ça marche</h2>
            <p className="mt-2 text-body-md text-ink-soft">Que vous cherchiez un logement ou souhaitiez en confier un.</p>
          </div>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <StepsColumn
              title="Vous cherchez un logement"
              description="Trouvez votre prochain chez-vous"
              headerIcon={Search}
              steps={RENTER_STEPS}
              accent="primary"
              ctaHref="/marketplace"
              ctaLabel="Voir les annonces"
            />
            <StepsColumn
              title="Vous avez un bien"
              description="Louez ou vendez en toute simplicité"
              headerIcon={HomeGlyph}
              steps={OWNER_STEPS}
              accent="info"
              ctaHref="/confier-un-bien"
              ctaLabel="Confier mon bien"
            />
          </div>
        </section>

        {/* Pourquoi Quick Immo — cartes de réassurance, une couleur d'accent
            par argument pour les distinguer d'un coup d'œil (vert = confiance,
            bleu marine = accompagnement, bleu = sérieux du suivi). */}
        <section className="border-y border-border bg-surface">
          <div className="content-shell flex flex-col gap-10 py-16">
            <div className="text-center">
              <h2 className="font-display text-headline-lg text-ink">Pourquoi Quick Immo</h2>
              <p className="mt-2 text-body-md text-ink-soft">Une plateforme pensée pour la confiance, pas pour la vitesse seule.</p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {VALUE_PROPS.map((p) => {
                const a = VALUE_ACCENT_CLASSES[p.accent];
                return (
                  <div
                    key={p.title}
                    className="group relative flex flex-col items-center gap-3 overflow-hidden rounded-xl border border-border bg-canvas px-6 pb-8 pt-7 text-center shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
                  >
                    <span className={`absolute inset-x-0 top-0 h-1.5 ${a.bar}`} aria-hidden />
                    <span className={`relative flex h-16 w-16 items-center justify-center rounded-full ${a.glow}`}>
                      <p.icon size={26} className={a.icon} strokeWidth={2} />
                    </span>
                    <p className="font-label-md text-body-lg text-ink">{p.title}</p>
                    <p className="text-body-sm text-ink-muted">{p.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Annonces à la une — vrais biens publiés, jamais des images de remplissage. */}
        <section className="content-shell flex flex-col gap-8 py-16">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-headline-lg text-ink">Annonces à la une</h2>
              <p className="mt-1 text-body-md text-ink-soft">Quelques biens actuellement disponibles.</p>
            </div>
            <Link href="/marketplace" className="hidden shrink-0 text-body-sm font-label-md text-primary hover:underline sm:inline">
              Voir toutes les annonces →
            </Link>
          </div>

          {!error && data && featured.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <p className="text-body-sm text-ink-muted">
                  Aucun bien disponible pour le moment — revenez bientôt, ou{" "}
                  <Link href="/contact" className="text-primary hover:underline">
                    contactez-nous
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>
          )}

          {featured.length > 0 && data && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((l) => (
                <ListingCard key={l.id} listing={l} tenantPhone={data.tenant.phone} />
              ))}
            </div>
          )}

          <Link href="/marketplace" className={buttonVariants({ variant: "secondary", className: "w-full justify-center sm:hidden" })}>
            Voir toutes les annonces
          </Link>
        </section>

        {/* CTA final. */}
        <section className="border-t border-border bg-primary-bg">
          <div className="content-shell flex flex-col items-center gap-4 py-16 text-center">
            <h2 className="font-display text-headline-lg text-ink">Prêt à commencer ?</h2>
            <p className="max-w-md text-body-md text-ink-soft">
              Créez votre compte pour suivre vos favoris ou vos demandes, gratuitement.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/inscription" className={buttonVariants({ variant: "primary", size: "lg" })}>
                Créer mon compte
              </Link>
              <Link href="/a-propos" className={buttonVariants({ variant: "ghost", size: "lg" })}>
                En savoir plus
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

/**
 * Visuel du hero — aucune vraie photo disponible pour l'instant (aucune
 * Unité n'est encore publiée), donc plutôt qu'une image de remplissage/
 * stock, une maquette flottante en CSS pur des cartes d'annonce
 * (aperçu honnête de ce que montre la marketplace) — toujours zéro octet
 * réseau, cohérent avec le reste du hero.
 */
/**
 * Visuel du hero — photo libre de droits (licence Unsplash, usage
 * commercial autorisé sans attribution), servie en local depuis `public/`
 * et optimisée par `next/image` (redimensionnement, format moderne,
 * chargement prioritaire réservé à cette seule image au-dessus de la
 * ligne de flottaison) plutôt qu'une dépendance à un hébergeur externe.
 */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-border shadow-xl">
        <Image
          src="/hero-house.jpg"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 448px, 90vw"
          className="object-cover"
        />
      </div>
      <div className="absolute -left-3 bottom-4 flex items-center gap-1.5 rounded-full border border-success-border bg-surface px-3 py-1.5 shadow-md sm:-left-6">
        <CheckCircle2 size={14} className="text-success-fg" />
        <span className="text-body-xs font-label-md text-success-fg">Bien vérifié</span>
      </div>
      <div className="absolute -right-3 -top-4 flex items-center gap-1.5 rounded-full border border-primary-border bg-surface px-3 py-1.5 shadow-md sm:-right-6">
        <HomeGlyph size={14} className="text-primary" />
        <span className="text-body-xs font-label-md text-primary">Agences partenaires</span>
      </div>
    </div>
  );
}

function StepsColumn({
  title,
  description,
  headerIcon: HeaderIcon,
  steps,
  accent,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  description: string;
  headerIcon: typeof Search;
  steps: { icon: typeof Search; title: string; text: string }[];
  accent: "primary" | "info";
  ctaHref: string;
  ctaLabel: string;
}) {
  const isPrimary = accent === "primary";
  const stepBadgeClass = isPrimary ? "bg-primary-bg text-primary" : "bg-info-bg text-info-fg";
  return (
    <Card className="flex flex-col overflow-hidden">
      <div
        className={`flex items-center gap-3 px-6 py-5 text-white ${
          isPrimary ? "bg-gradient-to-br from-primary to-primary-hover" : "bg-gradient-to-br from-info to-primary"
        }`}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15">
          <HeaderIcon size={24} />
        </span>
        <div>
          <p className="font-display text-headline-sm text-white">{title}</p>
          <p className="text-body-xs text-white/80">{description}</p>
        </div>
      </div>
      <CardContent className="flex flex-1 flex-col gap-5 py-6">
        {steps.map((s, i) => (
          <div key={s.title} className="flex items-start gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${stepBadgeClass}`}>
              <s.icon size={16} />
            </span>
            <div>
              <p className="text-body-sm font-label-md text-ink">
                {i + 1}. {s.title}
              </p>
              <p className="text-body-sm text-ink-muted">{s.text}</p>
            </div>
          </div>
        ))}
        <Link
          href={ctaHref}
          className={buttonVariants({ variant: isPrimary ? "primary" : "info", className: "mt-auto w-full justify-center" })}
        >
          {ctaLabel}
        </Link>
      </CardContent>
    </Card>
  );
}
