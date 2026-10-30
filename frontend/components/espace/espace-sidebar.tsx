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
  MessagesSquare,
  Wallet,
  Receipt,
  Banknote,
  Calculator,
  BellRing,
  Briefcase,
  CreditCard,
  History,
  Clock,
  Lock,
  Tag,
  Send,
  Settings,
  Stamp,
  LogOut,
  Menu,
  X,
  Home,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { API_URL } from "@/lib/api/client";
import { chatUnreadCount } from "@/lib/api/chat";
import { ROLE_LABELS } from "@/lib/constants/roles";
import { BrandLogo } from "@/components/brand/logo";
import { ConnectionIndicator } from "@/components/system/connection-indicator";
import { startQueueAutoSync } from "@/lib/offline/queue";
import { Badge } from "@/components/ui/badge";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import { CADRES, type Cadre } from "@/lib/module-theme";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; hint?: string; badge?: number };
type NavGroup = { cadre: Cadre; items: NavItem[] };

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
  // Rubriques repliées par l'utilisateur (mémorisé sur cet appareil). La rubrique de la page courante reste toujours ouverte.
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("aim_nav_collapsed");
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {}
  }, []);
  function toggleGroup(key: string) {
    setCollapsed((c) => {
      const next = { ...c, [key]: !c[key] };
      try {
        localStorage.setItem("aim_nav_collapsed", JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  React.useEffect(() => setMobileOpen(false), [pathname]);

  // Pastille « messages non lus » de la Discussion : sondage léger + mise à jour immédiate depuis la page.
  const [chatUnread, setChatUnread] = React.useState(0);
  React.useEffect(() => {
    if (!accessToken) return;
    let stop = false;
    const poll = () => {
      if (document.hidden) return;
      chatUnreadCount(accessToken).then((r) => { if (!stop) setChatUnread(r.count); }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 20000);
    const onEvt = (e: Event) => setChatUnread((e as CustomEvent<number>).detail ?? 0);
    window.addEventListener("aim:chat-unread", onEvt);
    return () => { stop = true; clearInterval(t); window.removeEventListener("aim:chat-unread", onEvt); };
  }, [accessToken]);

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
  const canAccountingAdvanced = isDg || user.permissions.includes("comptabilite_avancee");
  const chargesOn = tenant?.chargesEnabled !== false;
  const canCharges = chargesOn && (isDg || user.permissions.includes("charges"));
  const canSeePayments = isDg || user.permissions.includes("reversements_proprietaires") || user.permissions.includes("depenses_enregistrer");
  // Biens à vendre (demande utilisateur, 2026-10-18) — jamais accordée par défaut, le DG décide au cas
  // par cas (voir constants/permissions.js) : accès volontairement restreint, pas "tout comptable/agent".
  const canSaleProperties = isDg || user.permissions.includes("biens_a_vendre");

  const rawGroups: { cadre: Cadre; items: (NavItem | false)[] }[] = [
    {
      cadre: "apercu",
      items: [
        { href: "/espace", label: "Accueil", icon: Home },
        isDg && { href: "/espace/tableau-de-bord", label: "Tableau de bord", icon: LayoutDashboard },
      ],
    },
    {
      cadre: "patrimoine",
      items: [
        (canLocataires || canProprietaires) && { href: "/espace/biens", label: "Nos biens", icon: Building2 },
        // Annuaire ouvert à tout employé connecté (voir le commentaire de `EmployeeHome` et
        // `routes/owners.js`/`routes/renters.js` `canRead`) — volontairement pas de condition ici,
        // contrairement aux autres liens de ce menu.
        { href: "/espace/proprietaires", label: "Propriétaires", icon: Landmark },
        { href: "/espace/locataires", label: "Locataires", icon: Users },
        canSaleProperties && { href: "/espace/biens-a-vendre", label: "Biens à vendre", icon: Tag },
      ],
    },
    {
      cadre: "operations",
      items: [
        canPlaintes && { href: "/espace/plaintes", label: "Plaintes", icon: MessageSquareWarning },
        // `canCharges` manquait ici (audit du 2026-10-23) : la page Relances accepte déjà
        // locataires/comptabilite/charges (voir `relances-view.tsx`), le menu devait suivre.
        (canLocataires || canAccounting || canCharges) && { href: "/espace/relances", label: "Relances", icon: BellRing },
        // « Tâches » est remplacé par la Discussion interne (2026-10-30) ; la page /espace/taches reste accessible
        // depuis la carte « Mes tâches » de l'accueil et du tableau de bord.
        { href: "/espace/discussion", label: "Discussion", icon: MessagesSquare, badge: chatUnread },
      ],
    },
    {
      cadre: "finances",
      items: [
        canAccounting && { href: "/espace/comptabilite", label: "Trésorerie & recettes", icon: Wallet, hint: "Comptabilité de trésorerie : encaissements de loyers, décaissements et solde de caisse." },
        canAccounting && { href: "/espace/cloture", label: "Clôture mensuelle", icon: Lock, hint: "Arrêté des comptes du mois : bilan, contrôles de cohérence, verrouillage de la période." },
        canAccounting && { href: "/espace/comptabilite#depenses", label: "Charges d'exploitation", icon: Banknote, hint: "Dépenses de fonctionnement de l'entreprise et dépenses avancées pour le compte des propriétaires." },
        canAccountingAdvanced && { href: "/espace/comptabilite-avancee", label: "Comptabilité générale", icon: Calculator, hint: "Partie double SYSCOHADA : plan comptable, journaux, grand livre, balance, états financiers." },
        canCharges && { href: "/espace/charges", label: "Charges locatives", icon: Receipt, hint: "Factures SONEB/SBEE refacturées aux locataires et reversées aux propriétaires." },
        // Salaires (demande utilisateur, 2026-10-18) : réservé au DG, jamais délégable via une
        // permission — la rémunération du personnel reste une donnée sensible (même principe que
        // `/espace/employes`).
        // Paiements sortants FedaPay : lecture DG + comptable, envoi DG uniquement (contrôlé par le serveur).
        canSeePayments && { href: "/espace/paiements", label: "Paiements", icon: Send, hint: "Salaires, reversements aux propriétaires, dépenses et restitutions de caution, avec reçus." },
      ],
    },
    {
      cadre: "administration",
      items: [
        isDg && { href: "/espace/employes", label: "Employés", icon: Briefcase },
        isDg && { href: "/espace/journal", label: "Piste d'audit", icon: History, hint: "Journal horodaté de toutes les opérations, avec leur auteur." },
        isDg && { href: "/espace/abonnement", label: "Abonnement", icon: CreditCard },
        !isDg && { href: "/espace/historique", label: "Historique", icon: Clock },
      ],
    },
  ];
  const groups: NavGroup[] = rawGroups
    .map((g) => ({ ...g, items: g.items.filter((i): i is NavItem => !!i) }))
    .filter((g) => g.items.length > 0);

  function isActive(href: string) {
    if (href === "/espace") return pathname === "/espace";
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
        <BrandLogo withWordmark={false} className="h-8 w-8 shrink-0" />
      )}
      <span className="truncate font-label-md text-ink">{tenant?.companyName}</span>
    </Link>
  );

  const navContent = (
    <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Navigation principale">
      {groups.map((group) => {
        // Chaque rubrique porte la couleur de son cadre (voir `lib/module-theme.ts`) : pastille + titre,
        // icônes, entrée active — la même que le fond des pages de la rubrique.
        const cadre = CADRES[group.cadre];
        const hasActive = group.items.some((i) => isActive(i.href));
        const open = hasActive || !collapsed[group.cadre];
        return (
          <div key={group.cadre} className="mb-3 last:mb-0">
            <button
              type="button"
              onClick={() => toggleGroup(group.cadre)}
              aria-expanded={open}
              title={cadre.meaning}
              className="group/head mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-surface-muted"
            >
              <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", cadre.solid)} />
              <span className="flex-1 font-label-sm uppercase tracking-wider text-ink-faint transition-colors group-hover/head:text-ink-soft">
                {cadre.label}
              </span>
              <ChevronDown size={14} className={cn("text-ink-faint transition-transform duration-300", !open && "-rotate-90")} />
            </button>
            <div className={cn("grid transition-all duration-300 ease-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
              <div className="overflow-hidden">
                <div className="flex flex-col gap-0.5 pb-1">
                  {group.items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={item.hint}
                        tabIndex={open ? 0 : -1}
                        className={cn(
                          "group relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 font-label-md transition-all duration-200 ease-out",
                          active
                            ? cn(cadre.soft, "text-ink shadow-sm")
                            : "text-ink-soft hover:translate-x-1 hover:bg-surface-muted hover:text-ink",
                        )}
                      >
                        {active && (
                          <span
                            className={cn("absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 animate-fade-in rounded-full", cadre.solid)}
                            aria-hidden
                          />
                        )}
                        <item.icon
                          size={18}
                          className={cn("shrink-0 transition-all duration-200", cadre.text, active ? "scale-110" : "opacity-70 group-hover:scale-110 group-hover:opacity-100")}
                        />
                        <span className="truncate">{item.label}</span>
                        {!!item.badge && (
                          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-xs font-semibold text-white" aria-label={`${item.badge} message(s) non lu(s)`}>
                            {item.badge > 99 ? "99+" : item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-border p-3 pb-4">
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        {user.avatarUrl && accessToken ? (
          <AuthenticatedImage
            src={user.avatarUrl}
            accessToken={accessToken}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-body-sm font-semibold text-white">
            {initials}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-label-md text-ink">{user.firstName} {user.lastName}</p>
          <Badge variant="primary" className="mt-0.5">{user.jobTitle || (tenant?.roleTitles?.[user.role] ?? ROLE_LABELS[user.role] ?? user.role)}</Badge>
        </div>
        <ConnectionIndicator />
      </div>
      <div className="mt-1 flex flex-col gap-0.5">
        <Link
          href="/espace/mon-compte"
          className={cn(
            "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 font-label-md transition-colors",
            isActive("/espace/mon-compte") ? cn(CADRES.administration.soft, "text-ink") : "text-ink-soft hover:bg-surface-muted hover:text-ink",
          )}
        >
          <Stamp size={16} className={cn("shrink-0", CADRES.administration.text)} />
          Mon compte
        </Link>
        {isDg && (
          <Link
            href="/espace/parametres"
            className={cn(
              "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 font-label-md transition-colors",
              isActive("/espace/parametres") ? cn(CADRES.administration.soft, "text-ink") : "text-ink-soft hover:bg-surface-muted hover:text-ink",
            )}
          >
            <Settings size={16} className={cn("shrink-0", CADRES.administration.text)} />
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
