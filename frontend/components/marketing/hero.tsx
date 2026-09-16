import Link from "next/link";
import { ShieldCheck, WifiOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { formatFcfa } from "@/lib/utils";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Photo de fond (fournie par l'utilisateur, public/img/bg1.jpeg) — un
          simple <img>, jamais next/image : l'optimiseur est désactivé pour
          cette appli et son endpoint /_next/image fermé côté reverse-proxy
          (voir deploy/Caddyfile). Retour utilisateur : un flou ajouté ici en
          plus de celui, déjà présent, du sur-échantillonnage (source
          736×763 étirée sur toute la largeur) rendait le fond trop flou —
          retiré ; l'agrandissement du navigateur reste net à taille d'écran
          raisonnable. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/img/bg1.jpeg"
        alt=""
        aria-hidden="true"
        fetchPriority="high"
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      {/* Sous `lg`, la mise en page passe sur une seule colonne (le texte
          couvre alors toute la largeur) — un dégradé gauche→droite laisserait
          la partie droite du texte sur un fond trop clair. Voile uni sur
          mobile/tablette, dégradé directionnel seulement à partir de `lg`
          (là où le texte reste cantonné à la moitié gauche). `bg-[#F8FAFCED]`
          plutôt que `bg-canvas/93` : Tailwind ne génère pas le modificateur
          d'opacité sur cette couleur pour l'utilitaire `background-color` de
          base (constaté : la classe était absente du CSS généré), alors
          qu'il le fait pour les arrêts de dégradé juste après — valeur
          arbitraire directe, qui contourne le problème quelle qu'en soit la cause. */}
      <div className="absolute inset-0 bg-[#F8FAFCED] lg:bg-gradient-to-r lg:from-canvas lg:via-canvas/92 lg:to-canvas/45" />

      <div className="content-shell relative grid grid-cols-1 items-center gap-10 py-14 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-6">
          <h1 className="font-display text-headline-2xl text-ink sm:text-[2.75rem] sm:leading-[1.1]">
            Toute la gestion de votre entreprise, dans un seul espace sécurisé.
          </h1>

          <p className="max-w-xl text-body-lg text-ink-soft">
            Lyko System réunit vos locataires, propriétaires, contrats, paiements,
            réclamations, comptabilité et charges au même endroit, avec des rôles
            précis pour chaque employé et un fonctionnement qui résiste aux coupures
            de connexion.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/inscription" className={buttonVariants({ variant: "primary", size: "lg" })}>
              Créer mon compte
            </Link>
            <Link href="/connexion" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              Se connecter
            </Link>
          </div>

          <div className="flex flex-col gap-2 pt-2 text-body-sm text-ink-muted sm:flex-row sm:items-center sm:gap-6">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={16} className="text-primary" />
              Espace cloisonné par entreprise
            </span>
            <span className="inline-flex items-center gap-1.5">
              <WifiOff size={16} className="text-primary" />
              Fonctionne même hors connexion
            </span>
          </div>
        </div>

        {/* Aperçu produit — composants réels de la charte, pas une capture fictive */}
        <Card className="p-4 shadow-lg sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="font-label-sm uppercase tracking-wider text-ink-muted">Tableau de bord DG</p>
              <p className="font-display text-headline-sm text-ink">Vue du jour</p>
            </div>
            <Badge variant="success" dot>
              Synchronisé
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Loyers recouvrés"
              value={formatFcfa(18_450_000, { withSuffix: false })}
              unit="FCFA"
              trend={{ value: "+8,5 %", direction: "up" }}
            />
            <StatCard
              label="Impayés"
              tone="danger"
              value={formatFcfa(2_350_000, { withSuffix: false })}
              unit="FCFA"
              trend={{ value: "12 dossiers", direction: "down" }}
            />
          </div>

          <div className="mt-3 flex flex-col divide-y divide-border rounded-lg border border-border">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div>
                <p className="font-label-md text-ink">Mme Viviane AGBOTON</p>
                <p className="text-body-xs text-ink-muted">Appt 3B, Palmiers</p>
              </div>
              <Badge variant="success" dot>
                Payé
              </Badge>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <div>
                <p className="font-label-md text-ink">Pascal HOUNKPONOU</p>
                <p className="text-body-xs text-ink-muted">Lot 4, Rés. Palmiers</p>
              </div>
              <Badge variant="danger" dot>
                Retard 18 j
              </Badge>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <div>
                <p className="font-label-md text-ink">Facture SBEE, Haie Vive</p>
                <p className="text-body-xs text-ink-muted">Échéance demain</p>
              </div>
              <Badge variant="warning" dot>
                En attente
              </Badge>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
