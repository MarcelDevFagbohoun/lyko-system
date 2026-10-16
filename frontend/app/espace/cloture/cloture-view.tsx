"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, LockOpen, AlertTriangle, HelpCircle, ChevronDown, ChevronUp, CalendarClock, Pencil, History } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  getDashboard,
  listClosedPeriods,
  closePeriod,
  getAccountingStartDate,
  setAccountingStartDate,
  getTenantRhythm,
  setTenantRhythm,
  getOpenPeriod,
  type OpenPeriod,
  type AccountingDashboard,
  type AccountingPeriod,
  type AccountingStartDate,
  type TenantRhythm,
  type PeriodRhythmMode,
} from "@/lib/api/accounting";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";
import { formatDateLabel } from "@/lib/utils";

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

/** Libellé d'une période clôturée : « 2026-09 » en calendaire, sinon la plage réelle de dates. */
function closedPeriodLabel(p: AccountingPeriod): string {
  return p.period ?? `Du ${formatDateLabel(p.periodStart)} au ${formatDateLabel(p.periodEnd)}`;
}

function monthRange(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  const from = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

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
  const [yearMonth, setYearMonth] = React.useState(currentYearMonth());
  const { from, to } = monthRange(yearMonth);

  const [dashboard, setDashboard] = React.useState<AccountingDashboard | null>(null);
  const [closedPeriods, setClosedPeriods] = React.useState<AccountingPeriod[] | null>(null);
  const [rhythm, setRhythm] = React.useState<TenantRhythm | null>(null);
  // Incrémenté après chaque clôture ou changement de rythme : recharge la carte de la période ouverte.
  const [version, setVersion] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  // Rythme « jour fixe »/« libre » (étape 2b) : une période ne correspond pas à un mois civil — le
  // sélecteur de mois et la bannière mensuelle laissent la place à la carte de la période ouverte.
  const isCalendaire = !rhythm || rhythm.mode === "calendaire";

  const load = React.useCallback(() => {
    if (!accessToken) return;
    Promise.all([getDashboard(accessToken, from, to), listClosedPeriods(accessToken), getTenantRhythm(accessToken)])
      .then(([dash, periods, rh]) => {
        setDashboard(dash);
        setClosedPeriods(periods.periods);
        setRhythm(rh);
        setVersion((v) => v + 1);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la clôture des mois."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, from, to]);

  React.useEffect(() => load(), [load]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Clôture des mois</h1>
            <p className="text-body-md text-ink-soft">
              C&apos;est ici que chaque mois comptable se clôture, et l&apos;historique des clôtures déjà effectuées.
            </p>
          </div>
          {isCalendaire && (
            <Field label="Mois" htmlFor="yearMonth">
              <input
                id="yearMonth"
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </Field>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {isDg && (
          <>
            <HowMonthsWorkCard />
            <RhythmCard accessToken={accessToken} onSaved={load} />
            <StartDateCard accessToken={accessToken} isDg={isDg} />
          </>
        )}

        {isCalendaire
          ? dashboard && (
              <ClotureBanner yearMonth={yearMonth} dashboard={dashboard} isDg={isDg} accessToken={accessToken} onChanged={load} />
            )
          : isDg && <OpenPeriodCard key={version} accessToken={accessToken} onChanged={load} />}

        {closedPeriods && closedPeriods.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Historique des clôtures</CardTitle>
              <CardDescription>Périodes déjà clôturées, pour la traçabilité des recettes.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {closedPeriods.map((p) => (
                <div key={p.periodStart} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <span className="inline-flex items-center gap-2 font-label-md text-ink">
                    {closedPeriodLabel(p)}
                    {p.forced && <Badge variant="warning">Clôture anticipée</Badge>}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-body-xs text-ink-muted">
                      Clôturé le {p.closedAt.slice(0, 10)}
                      {p.closedBy ? ` par ${p.closedBy.name} (${p.closedBy.roleLabel})` : ""}
                    </span>
                    <Link href={`/espace/cloture/archive/${p.period ?? p.periodStart}`}>
                      <Button variant="secondary" size="sm">
                        <History size={14} />
                        {p.period ? "Archive du mois" : "Archive de la période"}
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Explication permanente (repliable) de comment un mois s'ouvre et se
 * ferme — demandée par l'utilisateur : les deux cartes ci-dessous (date de
 * démarrage, clôture) agissent chacune sur un mécanisme différent, jamais
 * clairement mis en relation ailleurs dans l'écran. Repliée par défaut pour
 * ne pas alourdir l'écran une fois comprise ; ouverte au premier chargement
 * de la page (avant toute interaction), pour qu'elle se voie une première fois.
 */
function HowMonthsWorkCard() {
  const [open, setOpen] = React.useState(true);

  return (
    <Card className="border-info-border bg-info-bg/40">
      <CardContent className="flex flex-col gap-3 py-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="inline-flex items-center gap-2 font-label-md text-ink">
            <HelpCircle size={18} className="text-info-fg" />
            Comment fonctionne l&apos;ouverture et la clôture d&apos;un mois ?
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
                <p className="font-label-md text-ink">Ouvrir un mois</p>
                <p>Rien à faire. Un mois est ouvert par défaut, tant qu&apos;il n&apos;a pas été clôturé.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger text-white">
                <Lock size={14} />
              </span>
              <div>
                <p className="font-label-md text-ink">Fermer (clôturer) un mois</p>
                <p>
                  Verrouille le mois pour toujours : plus aucun paiement, versement, dépense ou charge de ce mois ne
                  peut être ajouté, modifié ou supprimé, même par le DG. Seul le DG peut clôturer, une fois toutes
                  les échéances de loyer du mois passées.
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-surface px-3 py-2.5">
              <p className="font-label-sm uppercase tracking-wider text-ink-muted">Exemple</p>
              <p className="mt-1">
                Le 6 octobre, tous les loyers de septembre sont arrivés à échéance : le DG clique sur « Clôturer le
                mois » pour verrouiller septembre. Octobre, lui, est déjà ouvert automatiquement : on peut y
                enregistrer des paiements sans rien faire de particulier.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const RHYTHM_LABELS: Record<PeriodRhythmMode, string> = {
  calendaire: "Mois calendaire (1er au dernier jour du mois)",
  jour_fixe: "Jour fixe (ex. le 5 au 4 du mois suivant)",
  libre: "Dates libres (saisies à chaque clôture)",
};

/**
 * Sélecteur de rythme de période (étape 2b/5, 2026-10-16) — le mécanisme existe côté serveur depuis
 * l'étape 1. Change uniquement les PROCHAINES clôtures, jamais celles déjà faites. Limite connue :
 * les écrans de synthèse mensuelle (tableau de bord, « loyers du mois », exports comptables)
 * restent découpés par mois civil, quel que soit le rythme choisi.
 */
function RhythmCard({ accessToken, onSaved }: { accessToken: string | null; onSaved: () => void }) {
  const [data, setData] = React.useState<TenantRhythm | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [mode, setMode] = React.useState<PeriodRhythmMode>("calendaire");
  const [startDay, setStartDay] = React.useState("5");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getTenantRhythm(accessToken)
      .then((res) => {
        setData(res);
        setMode(res.mode);
        if (res.startDay) setStartDay(String(res.startDay));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le rythme de période."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function handleSave() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await setTenantRhythm(accessToken, mode, mode === "jour_fixe" ? Number(startDay) : null);
      setEditing(false);
      load();
      onSaved();
      toast.success("Rythme de période enregistré.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce rythme.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!data) return null;

  if (!editing) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <p className="inline-flex items-center gap-2 text-body-sm text-ink-soft">
            <CalendarClock size={16} className="text-ink-muted" />
            Rythme de période : <span className="font-label-md text-ink">{RHYTHM_LABELS[data.mode]}</span>
            {data.mode === "jour_fixe" && data.startDay && ` (jour ${data.startDay})`}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={14} />
            Modifier
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rythme de période</CardTitle>
        <CardDescription>
          Change uniquement les prochaines clôtures — aucune période déjà clôturée ne bouge jamais.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Rythme" htmlFor="rhythmMode">
            <select
              id="rhythmMode"
              value={mode}
              onChange={(e) => setMode(e.target.value as PeriodRhythmMode)}
              className="h-[38px] w-full max-w-md rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {Object.entries(RHYTHM_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </Field>
          {mode === "jour_fixe" && (
            <Field label="Jour de départ (1-28)" htmlFor="rhythmStartDay">
              <Input
                id="rhythmStartDay"
                type="number"
                min={1}
                max={28}
                value={startDay}
                onChange={(e) => setStartDay(e.target.value)}
              />
            </Field>
          )}
          <Button size="sm" onClick={handleSave} disabled={submitting}>
            {submitting ? "Enregistrement…" : "Enregistrer"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setError(null); }} disabled={submitting}>
            Annuler
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StartDateCard({ accessToken, isDg }: { accessToken: string | null; isDg: boolean }) {
  const [data, setData] = React.useState<AccountingStartDate | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getAccountingStartDate(accessToken)
      .then((res) => {
        setData(res);
        setValue(res.startDate ?? "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la date de démarrage."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  const toast = useToast();

  async function handleSave() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await setAccountingStartDate(accessToken, value || null);
      setEditing(false);
      load();
      toast.success(value ? "Date de démarrage enregistrée." : "Restriction de date retirée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette date.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!data) return null;

  const summary = data.startDate
    ? `Comptabilité active depuis le ${data.startDate}${data.setBy ? `, défini par ${data.setBy.name} (${data.setBy.roleLabel})` : ""}.`
    : "Aucune date de démarrage définie, toutes les dates sont autorisées.";

  if (!isDg) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <CalendarClock size={18} className="text-ink-muted" />
          <p className="text-body-sm text-ink-soft">{summary}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        {editing ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Date de démarrage de la comptabilité" htmlFor="accStartDate" hint="Laisser vide pour retirer la restriction">
              <Input id="accStartDate" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
            <Button size="sm" onClick={handleSave} disabled={submitting}>
              {submitting ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setEditing(false); setValue(data.startDate ?? ""); setError(null); }}
              disabled={submitting}
            >
              Annuler
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-body-sm text-ink-soft">
              <CalendarClock size={16} className="text-ink-muted" />
              {summary}
            </p>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Modifier
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Clôture d'une entreprise en rythme « jour fixe »/« libre » (étape 2b). Le début de la période
 * ouverte est toujours déduit par le serveur (lendemain de la dernière clôture, ou date de démarrage
 * de la comptabilité) ; sa fin est proposée en « jour fixe » et saisie par le DG en « libre ». Même
 * marge de sécurité qu'en calendaire : une clôture avant la dernière échéance de loyer de la période
 * reste possible, mais forcée et tracée.
 */
function OpenPeriodCard({ accessToken, onChanged }: { accessToken: string | null; onChanged: () => void }) {
  const [data, setData] = React.useState<OpenPeriod | null>(null);
  const [periodEnd, setPeriodEnd] = React.useState("");
  const [confirming, setConfirming] = React.useState<"normal" | "forced" | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (!accessToken) return;
    getOpenPeriod(accessToken)
      .then((res) => {
        setData(res);
        setPeriodEnd(res.proposedEnd ?? "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la période ouverte."));
  }, [accessToken]);

  if (error && !data) {
    return <p className="text-body-sm text-danger-fg">{error}</p>;
  }
  if (!data) return null;

  if (!data.periodStart) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <CalendarClock size={18} className="text-ink-muted" />
          <p className="text-body-sm text-ink-soft">
            Définissez d&apos;abord la date de démarrage de la comptabilité (ci-dessus) : la première période commencera à
            cette date.
          </p>
        </CardContent>
      </Card>
    );
  }

  const periodStart = data.periodStart;
  const today = new Date().toISOString().slice(0, 10);
  const end = data.mode === "libre" ? periodEnd : data.proposedEnd ?? "";
  const rangeLabel = `du ${formatDateLabel(periodStart)} au ${end ? formatDateLabel(end) : "…"}`;
  const notFinished = !!end && end > today;
  const forcedNeeded = !!data.closability && !data.closability.isClosable;

  async function handleClose(force: boolean) {
    if (!accessToken || !end) return;
    setSubmitting(true);
    setError(null);
    try {
      await closePeriod(accessToken, { periodEnd: end }, force);
      setConfirming(null);
      toast.success(`Période ${rangeLabel} clôturée${force ? " (clôture anticipée)" : ""}.`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de clôturer cette période.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className={forcedNeeded && !notFinished ? "border-warning-border bg-warning/10" : undefined}>
      <CardContent className="flex flex-col gap-3 py-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <p className="inline-flex items-center gap-2 font-label-md text-ink">
          <LockOpen size={16} className="text-success" />
          Période ouverte {rangeLabel}
        </p>

        {data.mode === "libre" && (
          <Field label="Date de fin de la période" htmlFor="openPeriodEnd" hint="Rythme libre : vous fixez la fin à chaque clôture">
            <Input
              id="openPeriodEnd"
              type="date"
              min={periodStart}
              max={today}
              value={periodEnd}
              onChange={(e) => {
                setPeriodEnd(e.target.value);
                setConfirming(null);
              }}
            />
          </Field>
        )}

        {!end ? null : notFinished ? (
          <p className="text-body-sm text-ink-soft">
            Cette période se termine le {formatDateLabel(end)} : elle pourra être clôturée à partir de cette date.
          </p>
        ) : confirming ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-body-sm text-ink">
              {confirming === "forced"
                ? `Clôturer la période ${rangeLabel} maintenant, avant que toutes les échéances ne soient passées ? Cette clôture anticipée sera tracée comme forcée.`
                : `Clôturer définitivement la période ${rangeLabel} ? Plus aucun paiement, versement, dépense ou charge daté dans cette période ne pourra être ajouté, modifié ou supprimé, par personne, y compris vous.`}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="destructive" size="sm" onClick={() => handleClose(confirming === "forced")} disabled={submitting}>
                {submitting ? "Clôture…" : confirming === "forced" ? "Oui, forcer la clôture" : "Oui, clôturer la période"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={submitting}>
                Annuler
              </Button>
            </div>
          </div>
        ) : forcedNeeded && data.closability ? (
          <div className="flex flex-col gap-2">
            <p className="inline-flex items-center gap-2 text-body-sm text-ink">
              <AlertTriangle size={16} className="text-warning" />
              Pas encore clôturable en toute sécurité, à partir du {formatDateLabel(data.closability.closableFrom)}.
            </p>
            {data.closability.pendingLeases.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-body-xs text-ink-muted">
                {data.closability.pendingLeases.map((l) => (
                  <li key={l.leaseId}>
                    {l.renterName} ({l.unitCode}), échéance le {formatDateLabel(l.dueDate)}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="danger" size="sm" className="self-start" onClick={() => setConfirming("forced")}>
              <Lock size={14} />
              Forcer la clôture maintenant
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-body-sm text-ink-soft">
              Période clôturable. Clôturez-la une fois toutes ses recettes enregistrées.
            </p>
            <Button variant="danger" size="sm" onClick={() => setConfirming("normal")}>
              <Lock size={14} />
              Clôturer la période
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClotureBanner({
  yearMonth,
  dashboard,
  isDg,
  accessToken,
  onChanged,
}: {
  yearMonth: string;
  dashboard: AccountingDashboard;
  isDg: boolean;
  accessToken: string | null;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = React.useState<"normal" | "forced" | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const toast = useToast();

  async function handleClose(force: boolean) {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await closePeriod(accessToken, { period: yearMonth }, force);
      setConfirming(null);
      onChanged();
      toast.success(`Mois ${yearMonth} clôturé${force ? " (clôture anticipée)" : ""}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de clôturer ce mois.");
    } finally {
      setSubmitting(false);
    }
  }

  if (dashboard.isClosed) {
    return (
      <Card className="border-ink-muted/30 bg-surface-muted">
        <CardContent className="flex items-center gap-3 py-4">
          <Lock size={18} className="text-ink-muted" />
          <div>
            <p className="font-label-md text-ink">
              Mois {yearMonth} clôturé
              {dashboard.closedInfo?.forced && (
                <Badge variant="warning" className="ml-2 align-middle">
                  Clôture anticipée
                </Badge>
              )}
            </p>
            <p className="text-body-xs text-ink-muted">
              {dashboard.closedInfo && `Le ${dashboard.closedInfo.closedAt.slice(0, 10)} par ${dashboard.closedInfo.closedBy?.name} (${dashboard.closedInfo.closedBy?.roleLabel})`}
              {". "}Plus aucune écriture financière ne peut être ajoutée, modifiée ou supprimée pour ce mois.
              {dashboard.closedInfo?.forced && " Clôturé avant que toutes les échéances de loyer du mois ne soient passées."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const closability = dashboard.closability;
  const isClosable = closability?.status === "closable";

  // Tant que le mois est ouvert, cette bannière n'apporte rien à un
  // comptable/agent (qui ne peut de toute façon pas clôturer) — retiré à
  // la demande de l'utilisateur. Seul l'état « clôturé » ci-dessus (qui
  // explique pourquoi une saisie est refusée) reste visible de tous.
  if (!isDg) {
    return null;
  }

  if (isClosable) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          {confirming === "normal" ? (
            <div className="flex flex-col gap-2">
              <p className="text-body-sm text-ink">
                Clôturer définitivement {yearMonth} ? Plus aucun paiement, versement, dépense ou charge daté dans ce mois
                ne pourra être ajouté, modifié ou supprimé, par personne, y compris vous.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="destructive" size="sm" onClick={() => handleClose(false)} disabled={submitting}>
                  {submitting ? "Clôture…" : `Oui, clôturer ${yearMonth}`}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={submitting}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-body-sm text-ink-soft">
                Mois {yearMonth} clôturable : toutes les échéances de loyer connues sont passées. Clôturez-le une fois
                toutes les recettes du mois enregistrées.
              </p>
              <Button variant="danger" size="sm" onClick={() => setConfirming("normal")}>
                <Lock size={14} />
                Clôturer le mois
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Mois pas encore clôturable : la marge de sécurité après la dernière
  // échéance connue n'est pas écoulée. Le DG peut forcer, mais avec un
  // avertissement clair et une trace de ce choix (`forced`).
  return (
    <Card className="border-warning-border bg-warning/10">
      <CardContent className="flex flex-col gap-3 py-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning text-white">
            <AlertTriangle size={16} />
          </span>
          <div className="flex flex-col gap-1">
            <p className="font-label-md text-ink">
              Mois {yearMonth} pas encore clôturable, à partir du {closability?.closableFrom}
            </p>
            <p className="text-body-sm text-ink-soft">
              {closability?.maxDueDay
                ? `Le locataire actif dont l'échéance tombe le plus tard ce mois-ci paie le ${closability.maxDueDay}. Une marge de sécurité de quelques jours s'applique avant de proposer la clôture comme sûre.`
                : "Marge de sécurité en cours."}
            </p>
            {closability && closability.pendingLeases.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-body-xs text-ink-muted">
                {closability.pendingLeases.map((l) => (
                  <li key={l.leaseId}>
                    {l.renterName} ({l.unitCode}), échéance le {l.dueDay}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {confirming === "forced" ? (
          <div className="flex flex-col gap-2 border-t border-warning-border pt-3">
            <p className="text-body-sm text-ink">
              Clôturer {yearMonth} maintenant, avant que toutes les échéances ne soient passées ? Cette clôture
              anticipée sera tracée comme forcée et restera visible dans l&apos;historique.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="destructive" size="sm" onClick={() => handleClose(true)} disabled={submitting}>
                {submitting ? "Clôture…" : "Oui, forcer la clôture"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={submitting}>
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <div className="border-t border-warning-border pt-3">
            <Button variant="danger" size="sm" onClick={() => setConfirming("forced")}>
              <Lock size={14} />
              Forcer la clôture maintenant
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
