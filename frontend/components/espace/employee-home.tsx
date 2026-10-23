"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight, BellRing, Building2, Calculator, ClipboardList, Landmark, ListTodo, MessageSquareWarning,
  Receipt, Send, Stamp, Tag, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { API_URL } from "@/lib/api/client";
import { ROLE_LABELS } from "@/lib/constants/roles";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import { Badge } from "@/components/ui/badge";
import { MyTasksCard } from "@/components/espace/my-tasks-card";
import { PriorityPanel } from "@/components/espace/priority-panel";
import { UtilityAlertsCard } from "@/components/charges/utility-alerts-card";
import { CADRES, type Cadre } from "@/lib/module-theme";
import { cn } from "@/lib/utils";

type Action = { href: string; label: string; description: string; icon: LucideIcon; cadre: Cadre; show: boolean };

function greeting(hour: number) {
  if (hour < 12) return "Bonjour";
  if (hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

/**
 * Accueil des employés (comptable, agent) : bandeau personnalisé, accès rapides regroupés par rubrique
 * (selon les permissions accordées), puis « à faire maintenant » et tâches. Chaque tuile porte la couleur
 * de sa rubrique — la même que dans le menu.
 */
export function EmployeeHome() {
  const { user, tenant, accessToken } = useAuth();
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => setNow(new Date()), []);
  if (!user) return null;

  const has = (p: string) => user.permissions.includes(p);
  const isComptable = user.role === "comptable";
  const jobTitle = user.jobTitle || tenant?.roleTitles?.[user.role] || ROLE_LABELS[user.role] || user.role;
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  const dateLabel = now?.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const actions: Action[] = [
    { href: "/espace/locataires", label: "Locataires", description: "Fiches, paiements et quittances", icon: Users, cadre: "patrimoine", show: has("locataires") },
    { href: "/espace/biens", label: "Nos biens", description: "Immeubles, unités et occupation", icon: Building2, cadre: "patrimoine", show: has("locataires") || has("proprietaires") },
    { href: "/espace/proprietaires", label: "Propriétaires", description: "Comptes et reversements", icon: Landmark, cadre: "patrimoine", show: has("proprietaires") },
    { href: "/espace/biens-a-vendre", label: "Biens à vendre", description: "Catalogue des biens en vente", icon: Tag, cadre: "patrimoine", show: has("biens_a_vendre") },
    { href: "/espace/plaintes", label: "Plaintes", description: "Suivre et traiter les réclamations", icon: MessageSquareWarning, cadre: "operations", show: has("plaintes") },
    { href: "/espace/relances", label: "Relances", description: "Loyers en retard à relancer", icon: BellRing, cadre: "operations", show: has("locataires") || has("comptabilite") },
    { href: "/espace/taches", label: "Mes tâches", description: "Ce qui vous est confié", icon: ListTodo, cadre: "operations", show: true },
    { href: "/espace/comptabilite", label: "Trésorerie & recettes", description: "Encaissements et solde de caisse", icon: Wallet, cadre: "finances", show: has("comptabilite") },
    { href: "/espace/charges", label: "Charges locatives", description: "Factures SONEB / SBEE", icon: Receipt, cadre: "finances", show: has("charges") },
    { href: "/espace/comptabilite-avancee", label: "Comptabilité générale", description: "Journaux, grand livre, balance", icon: Calculator, cadre: "finances", show: has("comptabilite_avancee") },
    { href: "/espace/paiements", label: "Paiements", description: "Salaires, reversements, reçus", icon: Send, cadre: "finances", show: isComptable },
    { href: "/espace/historique", label: "Mon historique", description: "Vos opérations récentes", icon: ClipboardList, cadre: "administration", show: true },
    { href: "/espace/mon-compte", label: "Mon compte", description: "Cachet, signature et mot de passe", icon: Stamp, cadre: "administration", show: true },
  ];
  const groups = (["patrimoine", "operations", "finances", "administration"] as Cadre[])
    .map((cadre) => ({ cadre, items: actions.filter((a) => a.cadre === cadre && a.show) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-8 py-8">
        {/* Bandeau d'accueil */}
        <section className="animate-fade-up relative overflow-hidden rounded-2xl bg-brand-gradient p-6 text-white shadow-lg sm:p-8">
          <span aria-hidden className="animate-float-slow pointer-events-none absolute -right-10 -top-12 h-52 w-52 rounded-full bg-white/10" />
          <span aria-hidden className="animate-float-slow pointer-events-none absolute -bottom-16 right-24 h-40 w-40 rounded-full bg-white/10 [animation-delay:-4s]" />
          <div className="relative flex flex-wrap items-center gap-5">
            {user.avatarUrl && accessToken ? (
              <AuthenticatedImage src={user.avatarUrl} accessToken={accessToken} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover ring-4 ring-white/30" />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/20 text-headline-sm font-semibold ring-4 ring-white/30">
                {initials}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-body-sm capitalize text-white/80">{dateLabel ?? " "}</p>
              <h1 className="font-display text-headline-xl">
                {greeting(now?.getHours() ?? 9)}, {user.firstName} <span className="animate-wave">👋</span>
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="neutral" className="bg-white/20 text-white">{jobTitle}</Badge>
                <span className="inline-flex items-center gap-2 text-body-sm text-white/85">
                  {tenant?.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${API_URL}${tenant.logoUrl}`} alt="" className="h-5 w-5 rounded bg-white/90 object-contain p-0.5" />
                  )}
                  {tenant?.companyName}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* À faire maintenant */}
        <div className="animate-fade-up [animation-delay:80ms]">
          <PriorityPanel />
        </div>

        {/* Accès rapides par rubrique */}
        <div className="flex flex-col gap-7">
          {groups.map((group, gi) => {
            const cadre = CADRES[group.cadre];
            return (
              <section key={group.cadre} className="animate-fade-up" style={{ animationDelay: `${140 + gi * 70}ms` }}>
                <div className="mb-3 flex items-center gap-2.5">
                  <span aria-hidden className={cn("h-5 w-1.5 rounded-full", cadre.solid)} />
                  <h2 title={cadre.meaning} className="font-label-md uppercase tracking-wider text-ink-soft">{cadre.label}</h2>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((a) => (
                    <Link
                      key={a.href}
                      href={a.href}
                      className="sheen group flex items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-transparent hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-3", cadre.soft, cadre.text)}>
                        <a.icon size={22} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-label-md text-ink">{a.label}</span>
                        <span className="block truncate text-body-sm text-ink-muted">{a.description}</span>
                      </span>
                      <ArrowRight size={16} className="shrink-0 text-ink-faint transition-transform duration-200 group-hover:translate-x-1 group-hover:text-ink" />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <div className="animate-fade-up [animation-delay:300ms]">
          <MyTasksCard />
        </div>
        {has("charges") && <UtilityAlertsCard hideWhenEmpty />}
      </div>
    </div>
  );
}
