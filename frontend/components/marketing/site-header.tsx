"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { LykoLogo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "#fonctionnalites", label: "Fonctionnalités" },
  { href: "#comment-ca-marche", label: "Comment ça marche" },
  { href: "#securite", label: "Sécurité & multi-entreprise" },
];

/** En-tête public — logo, ancres de la page, CTA inscription/connexion. */
export function SiteHeader() {
  const [open, setOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="content-shell flex h-topbar items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="Accueil Lyko System">
          <LykoLogo />
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Navigation principale">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="font-label-md text-ink-soft transition-colors hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link href="/connexion" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Se connecter
          </Link>
          <Link href="/inscription" className={buttonVariants({ variant: "primary", size: "sm" })}>
            Créer mon compte
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded text-ink-soft hover:bg-surface-muted md:hidden"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Panneau mobile */}
      <div
        className={cn(
          "flex-col gap-1 border-t border-border bg-surface px-4 py-3 md:hidden",
          open ? "flex" : "hidden",
        )}
      >
        {NAV_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={() => setOpen(false)}
            className="rounded px-2 py-2.5 font-label-md text-ink-soft hover:bg-surface-muted"
          >
            {link.label}
          </a>
        ))}
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
          <Link
            href="/connexion"
            onClick={() => setOpen(false)}
            className={buttonVariants({ variant: "secondary" })}
          >
            Se connecter
          </Link>
          <Link
            href="/inscription"
            onClick={() => setOpen(false)}
            className={buttonVariants({ variant: "primary" })}
          >
            Créer mon compte
          </Link>
        </div>
      </div>
    </header>
  );
}
