"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Settings, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { API_URL } from "@/lib/api/client";
import { ROLE_LABELS } from "@/lib/constants/roles";
import { LykoLogo } from "@/components/brand/logo";
import { ConnectionIndicator } from "@/components/system/connection-indicator";
import { startQueueAutoSync } from "@/lib/offline/queue";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * En-tête commun à toutes les pages de l'espace connecté (logo entreprise,
 * navigation, rôle, déconnexion). Responsive : la navigation complète (jusqu'à
 * 10 liens selon le rôle) ne tient plus en ligne sous `lg` (1024px) — repliée
 * dans un tiroir mobile (bouton hamburger), sur le même gabarit que
 * `SiteHeader` (marketing). Seuls logo + indicateur de connexion permanent
 * restent visibles dans la barre compacte à toutes les tailles.
 *
 * Ajustement (retour utilisateur) : même libellés courts et espacement
 * resserré, les 10 liens d'un DG ne rentrent pas toujours au-dessus de `lg`
 * (ex. ~1366px, résolution de portable courante) — `nav` défile alors
 * horizontalement (` overflow-x-auto`, barre de défilement masquée, dégradé
 * en bord droit comme indice visuel) plutôt que de couper silencieusement
 * un lien sans aucun moyen de l'atteindre.
 */
export function EspaceHeader() {
  const { user, tenant, logout, accessToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Referme le tiroir mobile à chaque changement de page.
  React.useEffect(() => setOpen(false), [pathname]);

  // Mode hors-ligne (étape 11) : rejoue la file d'attente dès que le réseau
  // revient. Un seul point d'entrée suffit puisque `EspaceHeader` est monté
  // sur toutes les pages de l'espace connecté.
  React.useEffect(() => {
    if (!accessToken) return;
    return startQueueAutoSync(() => accessToken);
  }, [accessToken]);

  const isDg = user?.role === "dg";
  const canLocataires = isDg || (user?.permissions.includes("locataires") ?? false);
  // Propriétaires (étape 5) : gérer sa fiche ne suffit pas à voir « Nos
  // biens » si on ne coche que `locataires` côté navigation — le patrimoine
  // (biens/unités) est accessible à `locataires` OU `proprietaires`, comme
  // côté backend (routes/properties.js).
  const canProprietaires = isDg || (user?.permissions.includes("proprietaires") ?? false);
  // Plaintes (étape 6) : permission dédiée, distincte de locataires — un
  // agent peut gérer les baux sans avoir accès aux plaintes, et inversement.
  const canPlaintes = isDg || (user?.permissions.includes("plaintes") ?? false);
  // Comptabilité (étape 8) : module strictement financier, réservé à qui a
  // la permission dédiée — pas d'élargissement aux agents.
  const canAccounting = isDg || (user?.permissions.includes("comptabilite") ?? false);
  // Charges SONEB/SBEE (étape 9) : permission dédiée `charges` (catalogue
  // depuis l'étape 3), par défaut comptable — distincte de locataires ET de
  // comptabilite.
  const canCharges = isDg || (user?.permissions.includes("charges") ?? false);

  const navLinks = [
    // Tableau de bord (étape 10) : vue d'ensemble multi-modules, réservée au
    // DG (cohérent avec la maquette « Supervision DG »).
    isDg && { href: "/espace/tableau-de-bord", label: "Tableau de bord" },
    (canLocataires || canProprietaires) && { href: "/espace/biens", label: "Nos biens" },
    // Locataires et Propriétaires : l'annuaire (liste, coordonnées, statut)
    // reste consultable par tout employé authentifié même sans permission
    // `locataires`/`proprietaires` assignée — seule la gestion (créer/
    // modifier) est restreinte, à l'intérieur de chaque page.
    // Libellés courts (pas « Gestion Propriétaires/Locataires ») : avec les
    // 10 entrées possibles pour le DG, la nav déborderait sinon dès ~1440px
    // (cf. ajustement responsive ci-dessous).
    { href: "/espace/proprietaires", label: "Propriétaires" },
    { href: "/espace/locataires", label: "Locataires" },
    canPlaintes && { href: "/espace/plaintes", label: "Plaintes" },
    canAccounting && { href: "/espace/comptabilite", label: "Comptabilité" },
    canCharges && { href: "/espace/charges", label: "Charges" },
    // Centre de relance (étape 10) : même accès que le bouton de relance
    // individuel existant depuis l'étape 4 (locataires) + comptabilité.
    (canLocataires || canAccounting) && { href: "/espace/relances", label: "Relances" },
    isDg && { href: "/espace/employes", label: "Employés" },
    isDg && { href: "/espace/journal", label: "Journal" },
  ].filter((l): l is { href: string; label: string } => !!l);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleLogout() {
    // Des actions hors-ligne (étape 11) pas encore synchronisées seraient
    // perdues à la déconnexion (le cache est vidé pour ne pas rester
    // consultable par le prochain employé sur un poste partagé) — on avertit
    // explicitement plutôt que de les effacer silencieusement.
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

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <div className="flex h-topbar items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/espace" className="flex shrink-0 items-center gap-3">
            {tenant?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${API_URL}${tenant.logoUrl}`}
                alt={`Logo ${tenant.companyName}`}
                className="h-8 w-auto object-contain"
              />
            ) : (
              <LykoLogo />
            )}
            <span className="hidden truncate font-label-md text-ink sm:inline">{tenant?.companyName}</span>
          </Link>

          {/* `overflow-x-auto` + dégradé en bord droit : filet de sécurité si
              tous les liens (jusqu'à 10 pour un DG) ne rentrent pas à cette
              largeur — jamais un lien caché sans aucun moyen de l'atteindre. */}
          <nav
            className="hidden min-w-0 items-center gap-0.5 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none] lg:flex [&::-webkit-scrollbar]:hidden"
            aria-label="Navigation principale"
          >
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "whitespace-nowrap rounded-lg px-2.5 py-1.5 font-label-md transition-colors",
                  isActive(link.href) ? "bg-surface-muted text-ink" : "text-ink-soft hover:bg-surface-muted hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <ConnectionIndicator />

          <div className="hidden items-center gap-3 lg:flex">
            {user && <Badge variant="primary">{ROLE_LABELS[user.role] ?? user.role}</Badge>}
            {isDg && (
              <Link
                href="/espace/parametres"
                aria-label="Paramètres"
                className="rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <Settings size={18} />
              </Link>
            )}
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              Se déconnecter
            </Button>
          </div>

          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-soft hover:bg-surface-muted lg:hidden"
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Tiroir mobile/tablette (< lg) : navigation complète + rôle + réglages + déconnexion. */}
      <div
        className={cn(
          "max-h-[calc(100dvh-theme(spacing.topbar))] flex-col gap-1 overflow-y-auto border-t border-border bg-surface px-4 py-3 lg:hidden",
          open ? "flex" : "hidden",
        )}
      >
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded px-2 py-2.5 font-label-md transition-colors",
              isActive(link.href) ? "bg-surface-muted text-ink" : "text-ink-soft hover:bg-surface-muted hover:text-ink",
            )}
          >
            {link.label}
          </Link>
        ))}

        <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
          {user && <Badge variant="primary">{ROLE_LABELS[user.role] ?? user.role}</Badge>}
          {isDg && (
            <Link
              href="/espace/parametres"
              className="inline-flex items-center gap-1.5 font-label-md text-ink-soft hover:text-ink"
            >
              <Settings size={16} />
              Paramètres
            </Link>
          )}
        </div>
        <button type="button" onClick={handleLogout} className={cn(buttonVariants({ variant: "secondary" }), "mt-2")}>
          Se déconnecter
        </button>
      </div>
    </header>
  );
}
