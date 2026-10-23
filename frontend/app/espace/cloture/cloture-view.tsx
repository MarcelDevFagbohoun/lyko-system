"use client";

import * as React from "react";
import Link from "next/link";
import {
  Lock,
  LockOpen,
  AlertTriangle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  Check,
  Minus,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  getDashboard,
  getClosingOverview,
  listClosedPeriods,
  closePeriod,
  getRentMonthRenters,
  type AccountingDashboard,
  type AccountingPeriod,
  type ClosingCheck,
  type ClosingMonthStatus,
  type ClosingOverview,
  type RentMonthRenter,
} from "@/lib/api/accounting";
import { MonthBilanPanel } from "./month-bilan-panel";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/lib/toast/toast-context";
import { cn, formatDateLabel, formatFcfa, monthLabelFr } from "@/lib/utils";

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

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function monthRange(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
}

/** Libellé d'une période clôturée (une ancienne clôture hors mois civil garde sa plage de dates). */
function closedPeriodLabel(p: AccountingPeriod): string {
  return p.period
    ? capitalize(monthLabelFr(p.period))
    : `Du ${formatDateLabel(p.periodStart)} au ${formatDateLabel(p.periodEnd)}`;
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

const STATUS_BADGE: Record<RentMonthRenter["status"], { variant: "success" | "warning" | "danger" | "info" | "neutral"; label: string }> = {
  paye: { variant: "success", label: "Payé" },
  partiel: { variant: "warning", label: "Partiel" },
  en_retard: { variant: "danger", label: "En retard" },
  a_payer: { variant: "info", label: "À payer" },
  a_venir: { variant: "neutral", label: "À venir" },
};

/**
 * Point financier de chaque locataire pour un mois clôturé (demande utilisateur, 2026-10-18) —
 * ouverte en cliquant une ligne de « Historique des clôtures ». Fonctionne par construction pour
 * n'importe quel mois (voir `listRentMonthRenters`, backend) : un mois déjà clôturé ne reçoit plus
 * aucun paiement rétroactif, le résultat y est donc déjà figé de fait.
 */
function MonthRentersModal({
  month,
  accessToken,
  onClose,
}: {
  month: string;
  accessToken: string | null;
  onClose: () => void;
}) {
  const [renters, setRenters] = React.useState<RentMonthRenter[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    setRenters(null);
    setError(null);
    getRentMonthRenters(accessToken, month)
      .then((rentersRes) => setRenters(rentersRes.renters))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le détail de ce mois."));
  }, [accessToken, month]);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="month-renters-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="month-renters-title" className="font-display text-headline-sm capitalize text-ink">
            Bilan — {monthLabelFr(month)}
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        <MonthBilanPanel month={month} accessToken={accessToken} />

        <p className="font-label-sm uppercase tracking-wider text-ink-muted">Loyer de ce mois, locataire par locataire</p>
        {renters === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : renters && renters.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucun locataire suivi sur ce mois.</p>
        ) : renters ? (
          <div className="overflow-y-auto">
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr className="border-b border-border text-left text-body-xs uppercase tracking-wider text-ink-muted">
                  <th className="py-2 pr-2 font-label-sm">Locataire</th>
                  <th className="py-2 pr-2 font-label-sm">Bien</th>
                  <th className="py-2 pr-2 text-right font-label-sm">Loyer</th>
                  <th className="py-2 pr-2 text-right font-label-sm">Payé</th>
                  <th className="py-2 pr-2 text-right font-label-sm">Reste</th>
                  <th className="py-2 text-center font-label-sm">Statut</th>
                </tr>
              </thead>
              <tbody>
                {renters.map((r) => {
                  const badge = STATUS_BADGE[r.status];
                  return (
                    <tr key={r.leaseId} className="border-b border-border-subtle last:border-0">
                      <td className="py-2 pr-2">
                        <Link
                          href={`/espace/locataires/${r.renterId}`}
                          className="font-label-sm text-primary hover:underline"
                        >
                          {r.renterName}
                        </Link>
                      </td>
                      <td className="py-2 pr-2 text-ink-soft">
                        <div>{r.unitLabel}</div>
                        <div className="text-body-xs text-ink-muted">{r.propertyLabel}</div>
                      </td>
                      <td className="py-2 pr-2 text-right tabular text-ink">{formatFcfa(r.monthlyRent)}</td>
                      <td className="py-2 pr-2 text-right tabular text-ink">{formatFcfa(r.paid)}</td>
                      <td className="py-2 pr-2 text-right tabular text-ink">{formatFcfa(r.remaining)}</td>
                      <td className="py-2 text-center">
                        <Badge variant={badge.variant} dot>
                          {badge.label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Explication (point 6) : ouverte à la toute première visite, repliée ensuite ─────────────────

const GUIDE_SEEN_KEY = "aim.cloture.guideSeen";

function HowMonthsWorkCard() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      if (!window.localStorage.getItem(GUIDE_SEEN_KEY)) {
        setOpen(true);
        window.localStorage.setItem(GUIDE_SEEN_KEY, "1");
      }
    } catch {
      // Stockage indisponible (navigation privée…) : l'explication reste simplement repliée.
    }
  }, []);

  return (
    <Card className="border-info-border bg-info-bg/40">
      <CardContent className="flex flex-col gap-3 py-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="inline-flex items-center gap-2 font-label-md text-ink">
            <HelpCircle size={18} className="text-info-fg" />
            Comment fonctionne la clôture d&apos;un mois ?
          </span>
          {open ? <ChevronUp size={18} className="text-ink-muted" /> : <ChevronDown size={18} className="text-ink-muted" />}
        </button>

        {open && (
          <div className="flex flex-col gap-4 border-t border-info-border pt-3 text-body-sm text-ink-soft">
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success text-white">
                <LockOpen size={14} />
              </span>
              <div>
                <p className="font-label-md text-ink">Un mois est ouvert par défaut</p>
                <p>Rien à faire pour ouvrir un mois : on peut y enregistrer paiements, dépenses et charges.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger text-white">
                <Lock size={14} />
              </span>
              <div>
                <p className="font-label-md text-ink">Clôturer verrouille le mois pour toujours</p>
                <p>
                  Plus aucun paiement, versement, dépense ou charge daté de ce mois ne peut être ajouté, modifié ou
                  supprimé, même par le DG. Seul le DG clôture, une fois les échéances de loyer du mois passées.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                <ArrowRight size={14} />
              </span>
              <div>
                <p className="font-label-md text-ink">Un mois après l&apos;autre</p>
                <p>On ne peut pas clôturer octobre avant septembre : cette page vous propose toujours le bon mois.</p>
              </div>
            </div>
            <div className="rounded-lg bg-surface px-3 py-2.5">
              <p className="font-label-sm uppercase tracking-wider text-ink-muted">Exemple</p>
              <p className="mt-1">
                Le 10 octobre, toutes les échéances de septembre sont passées : la page affiche « Septembre est prêt ».
                Vous vérifiez la liste, puis cliquez sur « Clôturer septembre ». Octobre reste ouvert, sans rien faire.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Frise des mois (point 2) ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ClosingMonthStatus, string> = {
  cloture: "Clôturé",
  pret: "Prêt à clôturer",
  en_attente: "En attente des échéances",
  en_cours: "Mois en cours",
  a_suivre: "À clôturer ensuite",
  hors_suivi: "Avant le démarrage",
};

const STATUS_CELL: Record<ClosingMonthStatus, string> = {
  cloture: "bg-ink-muted/80 text-white border-transparent",
  pret: "bg-success text-white border-transparent",
  en_attente: "bg-warning text-white border-transparent",
  en_cours: "bg-primary-bg text-primary border-primary/40",
  a_suivre: "bg-surface text-ink-muted border-border-strong border-dashed",
  hors_suivi: "bg-surface-muted text-ink-faint border-transparent",
};

function StatusIcon({ status }: { status: ClosingMonthStatus }) {
  const size = 14;
  // Étape 55 (partie Clôture) : le cadenas d'un mois clôturé se referme d'un coup sec.
  if (status === "cloture") return <Lock size={size} aria-hidden className="animate-lock-snap" />;
  if (status === "pret") return <Check size={size} strokeWidth={3} aria-hidden />;
  if (status === "en_attente") return <Clock size={size} aria-hidden />;
  if (status === "en_cours") return <LockOpen size={size} aria-hidden />;
  return <Minus size={size} aria-hidden />;
}

const LEGEND: ClosingMonthStatus[] = ["cloture", "pret", "en_attente", "a_suivre", "en_cours"];

function MonthStrip({ months: allMonths }: { months: ClosingOverview["months"] }) {
  // Les mois antérieurs au démarrage n'apportent rien : un seul est gardé, comme repère.
  const firstTracked = allMonths.findIndex((m) => m.status !== "hors_suivi");
  const months = firstTracked > 1 ? allMonths.slice(firstTracked - 1) : allMonths;
  const legend = months.some((m) => m.status === "hors_suivi") ? [...LEGEND, "hors_suivi" as const] : LEGEND;
  const stripRef = React.useRef<HTMLDivElement>(null);
  // Les mois récents (à droite) sont ceux qui comptent : la frise démarre défilée à la fin.
  React.useEffect(() => {
    if (stripRef.current) stripRef.current.scrollLeft = stripRef.current.scrollWidth;
  }, [months]);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <p className="font-label-sm uppercase tracking-wider text-ink-muted">Où en sont vos mois</p>
        <div ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-1" role="list" aria-label="État de clôture des mois">
          {months.map((m, i) => {
            const monthIndex = Number(m.month.slice(5, 7)) - 1;
            const detail =
              m.status === "en_attente" && m.closableFrom
                ? `${STATUS_LABEL[m.status]} — clôturable à partir du ${formatDateLabel(m.closableFrom)}`
                : STATUS_LABEL[m.status] + (m.forced ? " (clôture anticipée)" : "");
            return (
              <div
                key={m.month}
                role="listitem"
                title={`${capitalize(monthLabelFr(m.month))} — ${detail}`}
                className="flex min-w-[3rem] flex-1 flex-col items-center gap-1"
              >
                <span
                  className={cn(
                    "relative flex h-8 w-8 animate-cell-pop items-center justify-center rounded-md border",
                    STATUS_CELL[m.status],
                  )}
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  {/* Le mois prêt à clôturer appelle l'attention : une onde douce autour de sa case. */}
                  {m.status === "pret" && (
                    <span aria-hidden className="absolute inset-0 animate-ripple rounded-md border-2 border-success" />
                  )}
                  <StatusIcon status={m.status} />
                </span>
                <span
                  className={cn(
                    "text-body-xs",
                    m.status === "pret" || m.status === "en_attente" ? "font-label-md text-ink" : "text-ink-muted",
                  )}
                >
                  {MONTHS_SHORT[monthIndex]}
                </span>
                <span className="text-[10px] leading-none text-ink-faint">{m.month.slice(0, 4)}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-xs text-ink-muted">
          {legend.map((st) => (
            <span key={st} className="inline-flex items-center gap-1.5">
              <span className={cn("flex h-4 w-4 items-center justify-center rounded border", STATUS_CELL[st])}>
                <StatusIcon status={st} />
              </span>
              {STATUS_LABEL[st]}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Prochain mois à clôturer (points 1, 3, 4) ─────────────────────────────────────────────────

function NextMonthSection({
  overview,
  isDg,
  accessToken,
  onClosed,
}: {
  overview: ClosingOverview;
  isDg: boolean;
  accessToken: string | null;
  onClosed: () => void;
}) {
  if (!overview.nextMonth) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 size={18} className="text-success" />
          <p className="text-body-sm text-ink-soft">Aucune opération enregistrée pour l&apos;instant : rien à clôturer.</p>
        </CardContent>
      </Card>
    );
  }

  if (!overview.next) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 size={18} className="text-success" />
          <p className="text-body-sm text-ink-soft">
            Tout est à jour : prochain mois à clôturer, {monthLabelFr(overview.nextMonth)}, une fois terminé.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <NextMonthCard next={overview.next} months={overview.months} isDg={isDg} accessToken={accessToken} onClosed={onClosed} />;
}

function NextMonthCard({
  next,
  months,
  isDg,
  accessToken,
  onClosed,
}: {
  next: NonNullable<ClosingOverview["next"]>;
  months: ClosingOverview["months"];
  isDg: boolean;
  accessToken: string | null;
  onClosed: () => void;
}) {
  const label = monthLabelFr(next.month);
  const [dashboard, setDashboard] = React.useState<AccountingDashboard | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (!accessToken) return;
    const { from, to } = monthRange(next.month);
    getDashboard(accessToken, from, to)
      .then(setDashboard)
      .catch(() => {
        // Récapitulatif informatif : son absence n'empêche ni la vérification ni la clôture.
      });
  }, [accessToken, next.month]);

  const forced = !next.isClosable;
  const warnings = next.checks.filter((c) => c.status === "attention").length;
  const lagging = months.filter((m) => m.status === "a_suivre").length;

  async function handleClose() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await closePeriod(accessToken, { period: next.month }, forced);
      setConfirming(false);
      toast.success(`${capitalize(label)} est clôturé${forced ? " (clôture anticipée)" : ""}.`);
      onClosed();
    } catch (err) {
      setConfirming(false);
      setError(err instanceof ApiError ? err.message : "Impossible de clôturer ce mois.");
    } finally {
      setSubmitting(false);
    }
  }

  const status = next.isCurrentMonth
    ? { badge: <Badge variant="info">Mois en cours</Badge>, text: `Il pourra être clôturé à partir du ${formatDateLabel(next.closableFrom)}, une fois ses échéances passées.` }
    : next.isClosable
      ? { badge: <Badge variant="success">Prêt à clôturer</Badge>, text: "Toutes les échéances de loyer du mois sont passées." }
      : { badge: <Badge variant="warning">En attente</Badge>, text: `Clôture sûre à partir du ${formatDateLabel(next.closableFrom)}.` };

  return (
    <Card className={cn(!next.isCurrentMonth && next.isClosable && "border-success/40")}>
      <CardHeader>
        <p className="font-label-sm uppercase tracking-wider text-ink-muted">Prochain mois à clôturer</p>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-headline-md">{capitalize(label)}</CardTitle>
          {status.badge}
        </div>
        <CardDescription>
          {status.text}
          {lagging > 0 && ` Ensuite : ${lagging} autre${lagging > 1 ? "s" : ""} mois à clôturer, un par un.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>
        )}

        <div className="flex flex-col gap-2">
          <p className="font-label-sm uppercase tracking-wider text-ink-muted">Vérifications avant de clôturer</p>
          <ul className="flex flex-col gap-2">
            {next.checks.map((c) => (
              <CheckRow key={c.key} check={c} />
            ))}
          </ul>
          {warnings > 0 && (
            <p className="text-body-xs text-ink-muted">
              Les points en orange ne bloquent pas la clôture : un loyer payé plus tard s&apos;enregistre simplement sur le
              mois ouvert. Mais mieux vaut les régler avant, quand c&apos;est possible.
            </p>
          )}
        </div>

        {dashboard && <MonthRecap dashboard={dashboard} />}

        {next.isCurrentMonth ? null : isDg ? (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            {forced && (
              <p className="text-body-sm text-ink-soft">
                Vous pouvez clôturer dès maintenant, mais ce sera une clôture anticipée, signalée dans l&apos;historique.
              </p>
            )}
            <Button variant="danger" className="self-start" onClick={() => setConfirming(true)}>
              <Lock size={16} />
              {forced ? `Forcer la clôture de ${label}` : `Clôturer ${label}`}
            </Button>
          </div>
        ) : (
          <p className="border-t border-border pt-4 text-body-sm text-ink-soft">
            Seule la direction générale (DG) peut clôturer un mois. Signalez-lui quand ce mois est prêt.
          </p>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirming}
        icon={Lock}
        title={`Clôturer ${label} ?`}
        busy={submitting}
        confirmVariant="destructive"
        confirmLabel={forced ? "Oui, forcer la clôture" : `Oui, clôturer ${label}`}
        onCancel={() => setConfirming(false)}
        onConfirm={handleClose}
        description={
          <div className="flex flex-col gap-2">
            {dashboard && (
              <p>
                Vous allez figer <strong className="text-ink">{formatFcfa(dashboard.totals.rentCollected)}</strong> de loyers
                encaissés, <strong className="text-ink">{formatFcfa(dashboard.totals.expenses)}</strong> de dépenses et{" "}
                <strong className="text-ink">{formatFcfa(dashboard.totals.ownerPayouts)}</strong> reversés aux
                propriétaires.
              </p>
            )}
            <p>
              Plus aucun paiement, versement, dépense ou charge daté de {label} ne pourra être ajouté, modifié ou supprimé,
              par personne, y compris vous. C&apos;est définitif.
            </p>
            {warnings > 0 && (
              <p className="text-warning-fg">
                {warnings} point{warnings > 1 ? "s" : ""} de vérification reste{warnings > 1 ? "nt" : ""} à regarder.
              </p>
            )}
            {forced && <p className="text-warning-fg">Clôture anticipée : elle sera signalée dans l&apos;historique.</p>}
          </div>
        }
      />
    </Card>
  );
}

function CheckRow({ check }: { check: ClosingCheck }) {
  const icon =
    check.status === "ok" ? (
      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
    ) : check.status === "bloquant" ? (
      <Clock size={18} className="mt-0.5 shrink-0 text-warning" />
    ) : (
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
    );

  let content: React.ReactNode;
  switch (check.key) {
    case "echeances":
      content =
        check.status === "ok" ? (
          <p>Toutes les échéances de loyer du mois sont passées.</p>
        ) : (
          <div>
            <p>
              Des échéances de loyer ne sont pas encore passées : clôture sûre à partir du {formatDateLabel(check.closableFrom)}.
            </p>
            {check.pendingLeases.length > 0 && (
              <ul className="mt-1 text-body-xs text-ink-muted">
                {check.pendingLeases.map((l) => (
                  <li key={l.leaseId}>
                    {l.renterName} ({l.unitCode}), échéance le {l.dueDay}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      break;
    case "loyers":
      content =
        check.status === "ok" ? (
          <p>
            {check.expected > 0
              ? `Tous les loyers du mois sont encaissés (${formatFcfa(check.collected)}).`
              : "Aucun loyer attendu ce mois-ci."}
          </p>
        ) : (
          <p>
            {check.unpaidLeases} loyer{check.unpaidLeases > 1 ? "s" : ""} pas entièrement payé{check.unpaidLeases > 1 ? "s" : ""} :{" "}
            <strong className="text-ink">{formatFcfa(check.remaining)}</strong> restent à encaisser sur{" "}
            {formatFcfa(check.expected)}.{" "}
            <Link href="/espace/relances" className="text-primary underline-offset-2 hover:underline">
              Voir les relances
            </Link>
          </p>
        );
      break;
    case "releves":
      content =
        check.status === "ok" ? (
          <p>Aucun relevé SONEB/SBEE en brouillon sur ce mois.</p>
        ) : (
          <div>
            <p>
              {check.batches.length} relevé{check.batches.length > 1 ? "s" : ""} SONEB/SBEE encore en brouillon : validez-le
              {check.batches.length > 1 ? "s" : ""} pour facturer les locataires.
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 text-body-xs">
              {check.batches.map((b) => (
                <li key={b.id}>
                  <Link href={`/espace/charges/releve/${b.id}`} className="text-primary underline-offset-2 hover:underline">
                    {b.utilityType.toUpperCase()} — {b.propertyCode} (du {formatDateLabel(b.periodStart)} au{" "}
                    {formatDateLabel(b.periodEnd)})
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      break;
    default:
      content =
        check.status === "ok" ? (
          <p>Toutes les dépenses du mois ont leur justificatif.</p>
        ) : (
          <p>
            {check.count} dépense{check.count > 1 ? "s" : ""} sans justificatif ({formatFcfa(check.total)}) : joignez les reçus
            avant de clôturer.{" "}
            <Link href="/espace/comptabilite#depenses" className="text-primary underline-offset-2 hover:underline">
              Voir les dépenses
            </Link>
          </p>
        );
  }

  return (
    <li className="flex gap-2.5 rounded-lg border border-border px-3 py-2.5 text-body-sm text-ink-soft">
      {icon}
      {content}
    </li>
  );
}

/** Récapitulatif des montants du mois (point 4) — mêmes totaux que le tableau de bord comptable. */
function MonthRecap({ dashboard }: { dashboard: AccountingDashboard }) {
  const t = dashboard.totals;
  const items = [
    { label: "Loyers encaissés", value: t.rentCollected },
    { label: "Frais d'agence", value: t.entryFeesCollected },
    { label: "Dépenses", value: t.expenses },
    { label: "Reversés aux propriétaires", value: t.ownerPayouts },
    // Charges SONEB/SBEE impayées (demande utilisateur, 2026-10-18 : « une clôture nous devons
    // avoir ... les charges »), cumulées (pas bornées au mois, comme ailleurs sur ce total).
    { label: "Charges SONEB/SBEE impayées", value: t.unpaidCharges },
    { label: "Trésorerie réelle du mois", value: t.treasuryNet ?? t.netCashFlow },
  ];
  return (
    <div className="flex flex-col gap-2">
      <p className="font-label-sm uppercase tracking-wider text-ink-muted">Ce que vous allez figer</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg bg-surface-muted px-3 py-2">
            <p className="text-body-xs text-ink-muted">{it.label}</p>
            <p className="font-label-md tabular text-ink">{formatFcfa(it.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
