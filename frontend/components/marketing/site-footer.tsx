import Link from "next/link";
import { LykoLogo } from "@/components/brand/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="content-shell flex flex-col gap-8 py-10 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-sm flex-col gap-3">
          <LykoLogo />
          <p className="text-body-sm text-ink-muted">
            Plateforme de gestion pour entreprises immobilières et juridiques : locataires,
            propriétaires, paiements, réclamations, comptabilité et charges, dans un espace
            cloisonné par entreprise, utilisable même hors connexion.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Plateforme</span>
            <a href="#fonctionnalites" className="text-body-sm text-ink-soft hover:text-ink">
              Fonctionnalités
            </a>
            <a href="#comment-ca-marche" className="text-body-sm text-ink-soft hover:text-ink">
              Comment ça marche
            </a>
            <a href="#securite" className="text-body-sm text-ink-soft hover:text-ink">
              Sécurité
            </a>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Compte</span>
            <Link href="/connexion" className="text-body-sm text-ink-soft hover:text-ink">
              Se connecter
            </Link>
            <Link href="/inscription" className="text-body-sm text-ink-soft hover:text-ink">
              Créer mon compte
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="content-shell flex flex-col gap-2 py-4 text-body-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Lyko System. Tous droits réservés.</span>
          <span>Conçu pour les entreprises immobilières et juridiques au Bénin.</span>
        </div>
      </div>
    </footer>
  );
}
