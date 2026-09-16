"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Building2,
  Landmark,
  Users,
  MessageSquareWarning,
  Wallet,
  Receipt,
  BellRing,
  Briefcase,
  History,
  Clock,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { API_URL } from "@/lib/api/client";
import { ROLE_LABELS } from "@/lib/constants/roles";
import { LykoLogo } from "@/components/brand/logo";
import { ConnectionIndicator } from "@/components/system/connection-indicator";
import { startQueueAutoSync } from "@/lib/offline/queue";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
type NavGroup = { title: string; items: NavItem[] };

/**
 * Menu vertical de l'espace connecté — remplace l'ancien en-tête horizontal
 * (`EspaceHeader`, supprimé). Monté une seule fois par `app/espace/layout.tsx`,
 * jamais par chaque page individuellement (auparavant remonté à chaque
 * navigation, ce qui redéclenchait `startQueueAutoSync` — désormais un
 * unique point d'entrée pour toute la session, plus proche de l'intention
 * d'origine de ce hook).
 *
 * Responsive : sidebar fixe (`w-sidebar`, 260px) à partir de `lg` (1024px) ;
 * en dessous, une barre compacte + tiroir plein écran coulissant (overlay +
 * fondu de fond), plutôt qu'un simple repli comme avant — plus lisible sur
 * mobile avec jusqu'à 10 liens selon le rôle.
 *
 * Masqué tant que l'auth n'est pas résolue (`status !== "authenticated"`) :
 * `RequireAuth`, à l'intérieur de chaque page, affiche son propre écran de
 * chargement/accès refusé dans la zone `<main>` — jamais de menu peuplé qui
 * flashe avant une redirection vers /connexion.
 */
export function EspaceSidebar() {
  const { user, tenant, logout, accessToken, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => setMobileOpen(false), [pathname]);

  React.useEffect(() => {
    if (!accessToken) return;
    return startQueueAutoSync(() => accessToken);
  }, [accessToken]);

  if (status !== "authenticated" || !user) return null;

  const isDg = user.role === "dg";
  const canLocataires = isDg || user.permissions.includes("locataires");
  const canProprietaires = isDg || user.permissions.includes("proprietaires");
  const canPlaintes = isDg || user.permissions.includes("plaintes");
  const canAccounting = isDg || user.permissions.includes("comptabilite");
  const canCharges = isDg || user.permissions.includes("charges");

  const groups: NavGroup[] = [
    {
      title: "Vue d'ensemble",
      items: [isDg && { href: "/espace/tableau-de-bord", label: "Tableau de bord", icon: LayoutDashboard }],
    },
    {
      title: "Patrimoine",
      items: [
        (canLocataires || canProprietaires) && { href: "/espace/biens", label: "Nos biens", icon: Building2 },
        { href: "/espace/proprietaires", label: "Propriétaires", icon: Landmark },
        { href: "/espace/locataires", label: "Locataires", icon: Users },
      ],
    },
    {
      title: "Opérations",
      items: [
        canPlaintes && { href: "/espace/plaintes", label: "Plaintes", icon: MessageSquareWarning },
        (canLocataires || canAccounting) && { href: "/espace/relances", label: "Relances", icon: BellRing },
      ],
    },
    {
      title: "Finances",
      items: [
        canAccounting && { href: "/espace/comptabilite", label: "Comptabilité", icon: Wallet },
        canCharges && { href: "/espace/charges", label: "Charges", icon: Receipt },
      ],
    },
    {
      title: "Administration",
      items: [
        isDg && { href: "/espace/employes", label: "Employés", icon: Briefcase },
        isDg && { href: "/espace/journal", label: "Journal", icon: History },
        !isDg && { href: "/espace/historique", label: "Historique", icon: Clock },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i): i is NavItem => !!i) }))
    .filter((g) => g.items.length > 0);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleLogout() {
    const { queueList } = await import("@/lib/offline/db");
    const pending = await queueList();
    if (pending.length > 0) {
      const ok = window.confirm(
        `${pending.length} action(s) enregistrée(s) hors-ligne n'ont pas encore été synchronisées avec le serveur. Se déconnecter maintenant les fera perdre. Continuer ?`,
      );
      if (!ok) return;
    }
    await logout();
    router.replace("/connexion");
  }

  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();

  const brand = (
    <Link href="/espace" className="flex min-w-0 items-center gap-2.5">
      {tenant?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${API_URL}${tenant.logoUrl}`} alt={`Logo ${tenant.companyName}`} className="h-8 w-8 shrink-0 object-contain" />
      ) : (
        <LykoLogo withWordmark={false} className="h-8 w-8 shrink-0" />
      )}
      <span className="truncate font-label-md text-ink">{tenant?.companyName}</span>
    </Link>
  );

  const navContent = (
    <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Navigation principale">
      {groups.map((group) => (
        <div key={group.title} className="mb-5 last:mb-0">
          <p className="mb-1.5 px-2.5 font-label-sm uppercase tracking-wider text-ink-faint">{group.title}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 font-label-md transition-all duration-150 ease-out",
                    active
                      ? "bg-primary-bg text-primary"
                      : "text-ink-soft hover:translate-x-0.5 hover:bg-surface-muted hover:text-ink",
                  )}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-brand-gradient"
                      aria-hidden
                    />
                  )}
                  <item.icon
                    size={18}
                    className={cn(
                      "shrink-0 transition-colors",
                      active ? "text-primary" : "text-ink-muted group-hover:text-ink",
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-border p-3 pb-4">
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-body-sm font-semibold text-white">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-label-md text-ink">{user.firstName} {user.lastName}</p>
          <Badge variant="primary" className="mt-0.5">{ROLE_LABELS[user.role] ?? user.role}</Badge>
        </div>
        <ConnectionIndicator />
      </div>
      <div className="mt-1 flex flex-col gap-0.5">
        {isDg && (
          <Link
            href="/espace/parametres"
            className={cn(
              "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 font-label-md transition-colors",
              isActive("/espace/parametres") ? "bg-primary-bg text-primary" : "text-ink-soft hover:bg-surface-muted hover:text-ink",
            )}
          >
            <Settings size={16} className="shrink-0" />
            Réglages
          </Link>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 font-label-md text-ink-soft transition-colors hover:bg-danger-bg hover:text-danger-fg"
        >
          <LogOut size={16} className="shrink-0" />
          Se déconnecter
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Barre compacte mobile/tablette (< lg) : logo, connexion, hamburger. */}
      <div className="sticky top-0 z-30 flex h-topbar items-center justify-between border-b border-border bg-surface px-4 lg:hidden">
        {brand}
        <div className="flex shrink-0 items-center gap-2">
          <ConnectionIndicator />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-muted"
            aria-label="Ouvrir le menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* Fond assombri du tiroir mobile. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 animate-fade-in bg-ink/40 backdrop-blur-[2px] lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar : fixe dès `lg`, tiroir coulissant plein-hauteur avant. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-sidebar flex-col bg-surface lg:translate-x-0 lg:border-r lg:border-border",
          mobileOpen ? "animate-sidebar-in shadow-lg" : "-translate-x-full",
        )}
      >
        <div className="flex h-topbar shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          {brand}
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-muted lg:hidden"
            aria-label="Fermer le menu"
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        {navContent}
        {footer}
      </aside>
    </>
  );
}
