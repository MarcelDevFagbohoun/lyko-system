import Link from "next/link";
import { LykoLogo } from "@/components/brand/logo";
import { CONTACT } from "@/components/marketing/contact";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="content-shell flex flex-col gap-8 py-10 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-sm flex-col gap-3">
          <LykoLogo />
          <p className="text-body-sm text-ink-muted">
            Le logiciel de gestion locative pensé pour le Bénin : loyers, charges SONEB/SBEE,
            propriétaires, plaintes et comptabilité, dans un espace cloisonné par entreprise.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Plateforme</span>
            <a href="#fonctionnalites" className="text-body-sm text-ink-soft hover:text-ink">
              Pour qui
            </a>
            <a href="#charges" className="text-body-sm text-ink-soft hover:text-ink">
              Charges SONEB/SBEE
            </a>
            <a href="#argent" className="text-body-sm text-ink-soft hover:text-ink">
              Comptabilité
            </a>
            <a href="#securite" className="text-body-sm text-ink-soft hover:text-ink">
              Sécurité
            </a>
            <a href="#questions" className="text-body-sm text-ink-soft hover:text-ink">
              Questions
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
          <div className="flex flex-col gap-2">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Confiance</span>
            <Link href="/verifier" className="text-body-sm text-ink-soft hover:text-ink">
              Vérifier un document
            </Link>
            {CONTACT.whatsappUrl && (
              <a href={CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" className="text-body-sm text-ink-soft hover:text-ink">
                WhatsApp
              </a>
            )}
            {CONTACT.email && (
              <a href={`mailto:${CONTACT.email}`} className="text-body-sm text-ink-soft hover:text-ink">
                {CONTACT.email}
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="content-shell flex flex-col gap-2 py-4 text-body-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Lyko System. Tous droits réservés.</span>
          <span>Conçu au Bénin, pour les cabinets et agences immobilières.</span>
        </div>
      </div>
    </footer>
  );
}
