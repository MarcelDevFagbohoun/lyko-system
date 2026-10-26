"use client";

/**
 * Espace « Comptabilité avancée » (SYSCOHADA, livrable 7) — réservé aux
 * profils avec la permission `comptabilite_avancee` (Comptable, DG). Distinct
 * de `/espace/comptabilite` (saisie simple, en langage courant) : ici, le
 * vocabulaire comptable (débit/crédit, numéros de comptes) est assumé, comme
 * demandé ("le vocabulaire comptable n'apparaît que dans l'espace Comptabilité
 * avancée réservé aux profils autorisés").
 *
 * Une seule page à onglets internes (pas de sous-routes) : ce module reste un
 * espace de consultation/contrôle secondaire, pas une application à part —
 * même choix que `/espace/comptabilite` (une seule vue dense plutôt que
 * plusieurs pages) pour rester cohérent avec le reste de l'espace.
 */

import * as React from "react";
import Link from "next/link";
import {
  BookOpen,
  Wallet,
  Scale,
  CalendarRange,
  Settings2,
  Lock,
  Banknote,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  listGlAccounts,
  listGlJournals,
  listGlFiscalYears,
  getGlActivationStatus,
  type GlActivationStatus,
  type GlAccount,
  type GlJournal,
  type GlFiscalYear,
} from "@/lib/api/gl";
import { RequireAuth } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { BalanceTab } from "./sections/balance-tab";
import { DashboardTab } from "./sections/dashboard-tab";
import { ExercicesTab } from "./sections/exercices-tab";
import { GrandLivreTab } from "./sections/grand-livre-tab";
import { JournalTab } from "./sections/journal-tab";
import { RapprochementTab } from "./sections/rapprochement-tab";
import { ReglesTab } from "./sections/regles-tab";

type TabKey = "dashboard" | "journal" | "grandLivre" | "balance" | "exercices" | "regles" | "rapprochement";

const TABS: { key: TabKey; label: string; icon: typeof BookOpen }[] = [
  { key: "dashboard", label: "Vue d'ensemble", icon: Wallet },
  { key: "journal", label: "Journal", icon: BookOpen },
  { key: "grandLivre", label: "Grand livre", icon: CalendarRange },
  { key: "balance", label: "États financiers", icon: Scale },
  { key: "rapprochement", label: "Rapprochement bancaire", icon: Banknote },
  { key: "exercices", label: "Exercices", icon: Lock },
  { key: "regles", label: "Règles comptables", icon: Settings2 },
];

export function GlAvanceeView() {
  return (
    <RequireAuth permission="comptabilite_avancee">
      <GlAvanceeContent />
    </RequireAuth>
  );
}

function GlAvanceeContent() {
  const { accessToken, user } = useAuth();
  const isDg = user?.role === "dg";
  const [tab, setTab] = React.useState<TabKey>("dashboard");

  // Référentiels partagés entre onglets (comptes, journaux, exercices) :
  // chargés une seule fois ici plutôt que redemandés par chaque onglet.
  const [accounts, setAccounts] = React.useState<GlAccount[] | null>(null);
  const [journals, setJournals] = React.useState<GlJournal[] | null>(null);
  const [fiscalYears, setFiscalYears] = React.useState<GlFiscalYear[] | null>(null);
  const [status, setStatus] = React.useState<GlActivationStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadReferentiels = React.useCallback(() => {
    if (!accessToken) return;
    Promise.all([listGlAccounts(accessToken), listGlJournals(accessToken), listGlFiscalYears(accessToken)])
      .then(([a, j, fy]) => {
        setAccounts(a.accounts);
        setJournals(j.journals);
        setFiscalYears(fy.fiscalYears);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le référentiel comptable."));
  }, [accessToken]);

  const loadStatus = React.useCallback(() => {
    if (!accessToken || !isDg) return;
    getGlActivationStatus(accessToken)
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le statut du module."));
  }, [accessToken, isDg]);

  React.useEffect(() => loadReferentiels(), [loadReferentiels]);
  React.useEffect(() => loadStatus(), [loadStatus]);

  // Un comptable (non-DG) n'a pas accès à /activation/status (réservé au DG) —
  // on retombe alors sur la présence de comptes comme signal d'activation,
  // suffisant pour cette population (elle ne peut de toute façon ni activer
  // ni suspendre le module).
  const moduleActive = isDg ? !!status?.enabled : (accounts?.length ?? 0) > 0;
  const moduleInitialized = isDg ? !!status?.initialized : (accounts?.length ?? 0) > 0;
  const openFiscalYear = fiscalYears?.find((fy) => fy.status === "ouvert") ?? null;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-headline-lg text-ink">Comptabilité avancée</h1>
        <p className="text-body-sm text-ink-soft">
          Journal, grand livre, balance et écritures en partie double (SYSCOHADA) — pour un usage de comptable.
        </p>
      </div>

      {error && <p className="text-body-sm text-danger-fg">{error}</p>}

      {(isDg && !status) || (!isDg && !accounts) ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : !moduleInitialized ? (
        <Card>
          <CardHeader>
            <CardTitle>Comptabilité avancée non activée</CardTitle>
            <CardDescription>
              {isDg
                ? "Activez-la depuis Paramètres — c'est là que se décide le mode de comptabilité de l'entreprise, et que vous autorisez ensuite vos comptables à l'utiliser (fiche employé)."
                : "La comptabilité avancée SYSCOHADA n'a pas encore été activée pour votre entreprise. Seul le DG peut l'activer, depuis Paramètres."}
            </CardDescription>
          </CardHeader>
          {isDg && (
            <CardContent>
              <Link href="/espace/parametres">
                <Button size="sm">Aller dans Paramètres</Button>
              </Link>
            </CardContent>
          )}
        </Card>
      ) : (
        <>
          {isDg && !moduleActive && (
            <Card className="border-warning-border bg-warning-bg">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
                <div>
                  <p className="font-label-md text-warning-fg">Comptabilité avancée suspendue</p>
                  <p className="text-body-sm text-ink-soft">
                    Les nouvelles opérations ne génèrent plus d&apos;écriture. L&apos;historique déjà généré reste
                    consultable ci-dessous. Réactivez-la depuis Paramètres.
                  </p>
                </div>
                <Link href="/espace/parametres">
                  <Button variant="warning" size="sm">Ouvrir Paramètres</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex flex-wrap gap-1.5">
              {TABS.map((t) => (
                <Button
                  key={t.key}
                  type="button"
                  variant={tab === t.key ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setTab(t.key)}
                >
                  <t.icon size={14} />
                  {t.label}
                </Button>
              ))}
            </div>
          </div>

          {tab === "dashboard" && (
            <DashboardTab accessToken={accessToken} isDg={isDg} openFiscalYear={openFiscalYear} />
          )}
          {tab === "journal" && (
            <JournalTab
              accessToken={accessToken}
              accounts={accounts ?? []}
              journals={journals ?? []}
              openFiscalYear={openFiscalYear}
            />
          )}
          {tab === "grandLivre" && <GrandLivreTab accessToken={accessToken} accounts={accounts ?? []} />}
          {tab === "balance" && <BalanceTab accessToken={accessToken} fiscalYears={fiscalYears ?? []} />}
          {tab === "rapprochement" && <RapprochementTab accessToken={accessToken} />}
          {tab === "exercices" && (
            <ExercicesTab accessToken={accessToken} fiscalYears={fiscalYears ?? []} onChanged={loadReferentiels} />
          )}
          {tab === "regles" && (
            <ReglesTab accessToken={accessToken} accounts={accounts ?? []} onAccountsChanged={loadReferentiels} />
          )}
        </>
      )}
    </div>
  );
}

// ── Vue d'ensemble ─────────────────────────────────────────────────────────

