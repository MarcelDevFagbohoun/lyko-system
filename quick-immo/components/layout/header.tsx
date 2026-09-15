"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { Button, buttonVariants } from "@/components/ui/button";

const NAV_LINKS = [
  { href: "/", label: "Accueil" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/confier-un-bien", label: "Confier un bien" },
  { href: "/a-propos", label: "À propos" },
  { href: "/contact", label: "Contacter" },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { account, status, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  function handleLogout() {
    logout();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <div className="content-shell flex h-topbar items-center justify-between gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-fg">
            <Home size={16} />
          </span>
          <span className="font-display text-headline-sm text-ink">Quick Immo</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded px-3 py-2 text-body-sm font-label-md transition-colors ${
                isActive(l.href) ? "bg-primary-bg text-primary" : "text-ink-soft hover:bg-surface-muted"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {status === "authenticated" && account ? (
            <>
              <Link href="/mon-compte" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {account.firstName}
              </Link>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                Se déconnecter
              </Button>
            </>
          ) : (
            <>
              <Link href="/connexion" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Connexion
              </Link>
              <Link href="/inscription" className={buttonVariants({ variant: "primary", size: "sm" })}>
                Inscription
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded text-ink-soft lg:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Ouvrir le menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-surface px-4 py-3 lg:hidden">
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className={`rounded px-3 py-2 text-body-sm font-label-md ${
                  isActive(l.href) ? "bg-primary-bg text-primary" : "text-ink-soft"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
              {status === "authenticated" && account ? (
                <>
                  <Link href="/mon-compte" onClick={() => setMobileOpen(false)} className={buttonVariants({ variant: "secondary" })}>
                    {account.firstName}
                  </Link>
                  <Button variant="ghost" onClick={handleLogout}>
                    Se déconnecter
                  </Button>
                </>
              ) : (
                <>
                  <Link href="/connexion" onClick={() => setMobileOpen(false)} className={buttonVariants({ variant: "ghost" })}>
                    Connexion
                  </Link>
                  <Link href="/inscription" onClick={() => setMobileOpen(false)} className={buttonVariants({ variant: "primary" })}>
                    Inscription
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
