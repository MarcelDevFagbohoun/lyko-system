import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="content-shell flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display text-headline-sm text-ink">Quick Immo</p>
          <p className="text-body-sm text-ink-muted">Trouvez, louez ou vendez votre bien en toute confiance.</p>
        </div>
        <nav className="flex flex-wrap gap-4 text-body-sm text-ink-soft">
          <Link href="/" className="hover:text-primary">Accueil</Link>
          <Link href="/marketplace" className="hover:text-primary">Marketplace</Link>
          <Link href="/confier-un-bien" className="hover:text-primary">Confier un bien</Link>
          <Link href="/a-propos" className="hover:text-primary">À propos</Link>
          <Link href="/contact" className="hover:text-primary">Contacter</Link>
        </nav>
      </div>
      <div className="content-shell flex flex-col gap-1 border-t border-border py-4">
        <p className="text-body-xs text-ink-faint">
          © {new Date().getFullYear()} Quick Immo — plateforme reliée à des agences immobilières partenaires,
          propulsée par Lyko System.
        </p>
        <p className="text-body-xs text-ink-faint">
          Commission d&apos;agence plafonnée par la loi à 50 % du loyer pour toute location publiée ici.
        </p>
      </div>
    </footer>
  );
}
