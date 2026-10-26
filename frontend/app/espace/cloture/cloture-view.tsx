"use client";



import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  getClosingOverview,
  listClosedPeriods,
  type AccountingPeriod,
  type ClosingOverview,
} from "@/lib/api/accounting";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { formatDateLabel, monthLabelFr } from "@/lib/utils";
import { HowMonthsWorkCard } from "./sections/guide-card";
import { MonthRentersModal } from "./sections/month-renters-modal";
import { MonthStrip } from "./sections/month-strip";
import { NextMonthSection } from "./sections/next-month";
import { closedPeriodLabel } from "./sections/shared";


/**
 * Clôture des mois (refonte étape 54, demande de l'utilisateur : « facile et claire à utiliser ») :
 *  1. la page s'ouvre directement sur le PROCHAIN mois à clôturer (les mois se clôturent dans
 *     l'ordre — plus de sélecteur de mois ni d'erreur « clôturez d'abord … » après coup) ;
 *  2. une frise montre où en est chaque mois (clôturé, prêt, en attente, en cours) ;
 *  3. une liste de vérifications fait le point avant de verrouiller ;
 *  4. la confirmation récapitule les montants que l'on fige ;
 *  6. la page ne parle plus que de clôture (date de démarrage déplacée dans Paramètres).
 * Le calcul vient du serveur (`GET /api/accounting/closing-overview`) : aucune règle ici.
 */
export function ClotureView() {
  return (
    <RequireAuth permission="comptabilite">
      <ClotureContent />
    </RequireAuth>
  );
}

function ClotureContent() {
  const { accessToken, user } = useAuth();
  const isDg = user?.role === "dg";
  const [overview, setOverview] = React.useState<ClosingOverview | null>(null);
  const [closedPeriods, setClosedPeriods] = React.useState<AccountingPeriod[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Point financier par locataire sur un mois clôturé (demande utilisateur, 2026-10-18) — ouvert en
  // cliquant une ligne de « Historique des clôtures » ci-dessous.
  const [detailMonth, setDetailMonth] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    Promise.all([getClosingOverview(accessToken), listClosedPeriods(accessToken)])
      .then(([ov, periods]) => {
        setOverview(ov);
        setClosedPeriods(periods.periods);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la clôture des mois."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div>
          <h1 className="font-display text-headline-xl text-ink">Clôture des mois</h1>
          <p className="text-body-md text-ink-soft">
            Clôturer un mois le verrouille pour toujours : ses chiffres ne bougent plus. Les mois se clôturent un par
            un, dans l&apos;ordre.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        <HowMonthsWorkCard />

        {overview && (
          <>
            <MonthStrip months={overview.months} />
            <NextMonthSection overview={overview} isDg={isDg} accessToken={accessToken} onClosed={load} />
            {isDg && !overview.accountingStartDate && closedPeriods?.length === 0 && overview.nextMonth && (
              <p className="text-body-sm text-ink-muted">
                Le premier mois à clôturer est celui de votre toute première opération ({monthLabelFr(overview.nextMonth)}).
                Pour commencer plus tard, définissez la{" "}
                <Link href="/espace/parametres#demarrage-comptabilite" className="text-primary underline-offset-2 hover:underline">
                  date de démarrage de la comptabilité
                </Link>{" "}
                dans Paramètres.
              </p>
            )}
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Consulter un mois</CardTitle>
            <CardDescription>
              Entrées, versements, point locataires, point propriétaires et dépenses de n&apos;importe quel mois,
              clôturé ou non.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              type="month"
              aria-label="Mois à consulter"
              max={new Date().toISOString().slice(0, 7)}
              onChange={(e) => e.target.value && setDetailMonth(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-body-md text-ink"
            />
          </CardContent>
        </Card>

        {closedPeriods && closedPeriods.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Historique des clôtures</CardTitle>
              <CardDescription>Mois déjà clôturés, du plus récent au plus ancien.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {closedPeriods.map((p) => (
                <button
                  key={p.periodStart}
                  type="button"
                  disabled={!p.period}
                  onClick={() => p.period && setDetailMonth(p.period)}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-left transition-colors enabled:hover:border-primary enabled:hover:bg-primary-bg/40 disabled:cursor-default"
                >
                  <span className="inline-flex items-center gap-2 font-label-md text-ink">
                    <Lock size={14} className="text-ink-muted" />
                    {closedPeriodLabel(p)}
                    {p.forced && <Badge variant="warning">Clôture anticipée</Badge>}
                  </span>
                  <span className="text-body-xs text-ink-muted">
                    Clôturé le {formatDateLabel(p.closedAt.slice(0, 10))}
                    {p.closedBy ? ` par ${p.closedBy.name} (${p.closedBy.roleLabel})` : ""}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {detailMonth && (
        <MonthRentersModal month={detailMonth} accessToken={accessToken} onClose={() => setDetailMonth(null)} />
      )}
    </div>
  );
}

