"use client";

import * as React from "react";
import Link from "next/link";
import { Wallet, TrendingUp, TrendingDown, Scale, Droplets, AlertTriangle, Lock, Plus, FileDown, FileSpreadsheet, Trash2, Pencil, History, CalendarClock, HelpCircle, ChevronDown, ChevronUp, LockOpen } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { API_URL, ApiError, openAuthenticatedPdf, downloadAuthenticatedFile } from "@/lib/api/client";
import {
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getDashboard,
  accountingReportPdfPath,
  accountingExportXlsxPath,
  listRentPayments,
  listOwnerPayouts,
  listClosedPeriods,
  closePeriod,
  listDeletedEntries,
  getAccountingStartDate,
  setAccountingStartDate,
  type Expense,
  type ExpenseCategory,
  type AccountingDashboard,
  type RentPaymentEntry,
  type OwnerPayoutEntry,
  type AccountingPeriod,
  type DeletedEntry,
  type AccountingStartDate,
} from "@/lib/api/accounting";
import type { PaymentMethod } from "@/lib/api/renters";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants/expenses";
import { UTILITY_TYPE_LABELS } from "@/lib/constants/charges";
import { formatFcfa, formatDateHeading, formatTimeOfDay } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";

const CATEGORIES = Object.entries(EXPENSE_CATEGORY_LABELS) as [ExpenseCategory, string][];
const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

// Toute nouvelle écriture (dépense...) s'ancre sur le mois actuellement
// ouvert (aujourd'hui), jamais sur le mois historique en cours de
// consultation via le sélecteur de période — sinon une dépense créée en
// consultant un ancien mois clôturé se verrait systématiquement refusée.
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthRange(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  const from = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export function ComptabiliteView() {
  return (
    <RequireAuth permission="comptabilite">
      <ComptabiliteContent />
    </RequireAuth>
  );
}

function ComptabiliteContent() {
  const { accessToken, user } = useAuth();
  const isDg = user?.role === "dg";
  const [yearMonth, setYearMonth] = React.useState(currentYearMonth());
  const { from, to } = monthRange(yearMonth);

  const [dashboard, setDashboard] = React.useState<AccountingDashboard | null>(null);
  const [expenses, setExpenses] = React.useState<Expense[] | null>(null);
  const [rentPayments, setRentPayments] = React.useState<RentPaymentEntry[] | null>(null);
  const [ownerPayouts, setOwnerPayouts] = React.useState<OwnerPayoutEntry[] | null>(null);
  const [closedPeriods, setClosedPeriods] = React.useState<AccountingPeriod[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [exportingXlsx, setExportingXlsx] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    Promise.all([
      getDashboard(accessToken, from, to),
      listExpenses(accessToken, { from, to }),
      listRentPayments(accessToken, from, to),
      listOwnerPayouts(accessToken, from, to),
      listClosedPeriods(accessToken),
    ])
      .then(([dash, exp, rp, op, periods]) => {
        setDashboard(dash);
        setExpenses(exp.expenses);
        setRentPayments(rp.payments);
        setOwnerPayouts(op.payouts);
        setClosedPeriods(periods.periods);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la comptabilité."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, from, to]);

  React.useEffect(() => load(), [load]);

  const isClosed = dashboard?.isClosed ?? false;

  // Regroupe le journal par jour de SAISIE (préfixe de `createdAt`, pas
  // `expenseDate`) : l'ordre reçu du back-end est déjà décroissant sur ce
  // même champ, donc chaque groupe hérite naturellement du bon ordre interne.
  const expenseGroups = React.useMemo(() => {
    if (!expenses) return [];
    const groups: { dateKey: string; items: Expense[]; total: number }[] = [];
    for (const e of expenses) {
      const dateKey = e.createdAt.slice(0, 10);
      const last = groups[groups.length - 1];
      if (last && last.dateKey === dateKey) {
        last.items.push(e);
        last.total += e.amount;
      } else {
        groups.push({ dateKey, items: [e], total: e.amount });
      }
    }
    return groups;
  }, [expenses]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Comptabilité</h1>
            <p className="text-body-md text-ink-soft">Recettes et dépenses du cabinet, classées par nature, mois par mois.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Période" htmlFor="yearMonth">
              <input
                id="yearMonth"
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </Field>
            <Button
              variant="secondary"
              onClick={() => accessToken && openAuthenticatedPdf(accountingReportPdfPath(from, to), accessToken)}
            >
              <FileDown size={16} />
              Rapport mensuel
            </Button>
            <Button
              variant="secondary"
              disabled={exportingXlsx}
              onClick={async () => {
                if (!accessToken) return;
                setExportingXlsx(true);
                setError(null);
                try {
                  await downloadAuthenticatedFile(
                    accountingExportXlsxPath(from, to),
                    accessToken,
                    `registre-comptable-${from}-au-${to}.xlsx`,
                  );
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Export impossible.");
                } finally {
                  setExportingXlsx(false);
                }
              }}
            >
              <FileSpreadsheet size={16} />
              {exportingXlsx ? "Export…" : "Exporter (Excel)"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {isDg && (
          <>
            <HowMonthsWorkCard />
            <StartDateCard accessToken={accessToken} isDg={isDg} />
          </>
        )}

        {dashboard && (
          <ClotureBanner
            yearMonth={yearMonth}
            dashboard={dashboard}
            isDg={isDg}
            accessToken={accessToken}
            onChanged={load}
          />
        )}

        {dashboard && <DashboardCards dashboard={dashboard} />}

        {dashboard && dashboard.tenantArrears.length > 0 && (
          <Card className="border-danger-border bg-danger/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-danger text-white">
                  <AlertTriangle size={14} />
                </span>
                <CardTitle>Impayés locataires (en cours)</CardTitle>
              </div>
              <CardDescription>
                Estimation calculée à partir des jours de retard, du nombre de mois dus et du loyer. Additionnée
                automatiquement, rien n&apos;est saisi manuellement.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {dashboard.tenantArrears.map((a) => (
                <div key={a.leaseId} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <p className="font-label-md text-ink">{a.renterName}</p>
                    <p className="text-body-xs text-ink-muted">
                      {a.daysLate} j de retard · {a.unpaidMonths} mois dû(s)
                    </p>
                  </div>
                  <span className="tabular font-currency-table text-danger-fg">{formatFcfa(a.amountOwed)}</span>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
                <span className="font-label-md text-ink">Total impayés locataires</span>
                <span className="tabular font-currency-table text-headline-sm text-danger-fg">
                  {formatFcfa(dashboard.totals.tenantArrears)}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Un fond teinté par registre (vert = encaissé, bleu = reversé, orange = dépensé) : les
            trois listes se suivent à l'écran et se ressemblaient trop, difficile de savoir dans
            laquelle on se trouve d'un coup d'œil. */}
        <Card className="border-success-border bg-success/5">
          <CardHeader>
            <CardTitle>Paiements des locataires</CardTitle>
            <CardDescription>Loyers encaissés sur la période sélectionnée.</CardDescription>
          </CardHeader>
          <CardContent>
            {rentPayments === null ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : rentPayments.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucun paiement de loyer sur cette période.</p>
            ) : (
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Locataire</TableHead>
                    <TableHead>Unité</TableHead>
                    <TableHead>Mois concerné</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Enregistré par</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {rentPayments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.renter.firstName} {p.renter.lastName}</TableCell>
                      <TableCell className="text-ink-soft">{p.unitCode}</TableCell>
                      <TableCell className="text-ink-soft">{p.coversMonth}</TableCell>
                      <TableAmount>{formatFcfa(p.amount)}</TableAmount>
                      <TableCell className="text-ink-soft">{p.paymentMethodLabel}</TableCell>
                      <TableCell className="text-ink-soft">{p.paidAt}</TableCell>
                      <TableCell className="text-ink-soft">
                        {p.recordedBy ? `${p.recordedBy.name} (${p.recordedBy.roleLabel})` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-info-border bg-info/5">
          <CardHeader>
            <CardTitle>Versements aux propriétaires</CardTitle>
            <CardDescription>Loyers nets reversés sur la période sélectionnée.</CardDescription>
          </CardHeader>
          <CardContent>
            {ownerPayouts === null ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : ownerPayouts.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucun versement propriétaire sur cette période.</p>
            ) : (
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Propriétaire</TableHead>
                    <TableHead>Période versement</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Enregistré par</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {ownerPayouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`/espace/proprietaires/${p.owner.id}`} className="text-primary hover:underline">
                          {p.owner.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-ink-soft">{p.periodLabel}</TableCell>
                      <TableAmount>{formatFcfa(p.amount)}</TableAmount>
                      <TableCell className="text-ink-soft">{p.paymentMethodLabel}</TableCell>
                      <TableCell className="text-ink-soft">{p.paidAt}</TableCell>
                      <TableCell className="text-ink-soft">
                        {p.recordedBy ? `${p.recordedBy.name} (${p.recordedBy.roleLabel})` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-warning-border bg-warning/5">
          <CardHeader>
            <CardTitle>Journal des dépenses</CardTitle>
            <CardDescription>
              Dépenses de fonctionnement du cabinet pour la période sélectionnée. Les travaux facturés à un Bien
              (repérés par son code ci-dessous) sont à la charge du propriétaire et n&apos;entrent pas dans les
              totaux du cabinet.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {isClosed ? (
              <p className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm text-ink-muted">
                <Lock size={14} /> Mois clôturé, aucune nouvelle dépense ne peut être ajoutée.
              </p>
            ) : (
              <ExpenseForm accessToken={accessToken} onCreated={load} />
            )}

            {expenses === null ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : expenses.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucune dépense enregistrée pour cette période.</p>
            ) : (
              <div className="flex flex-col gap-5">
                {expenseGroups.map((group) => (
                  <div key={group.dateKey}>
                    <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
                      <p className="font-label-md text-body-sm text-ink">{formatDateHeading(group.dateKey)}</p>
                      <p className="text-body-xs text-ink-muted">
                        {group.items.length} écriture{group.items.length > 1 ? "s" : ""} · {formatFcfa(group.total)}
                      </p>
                    </div>
                    <Table>
                      <TableHeader>
                        <tr>
                          <TableHead>Heure</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Libellé</TableHead>
                          <TableHead>Catégorie</TableHead>
                          <TableHead className="text-right">Montant</TableHead>
                          <TableHead>Mode</TableHead>
                          <TableHead>Enregistré par</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </tr>
                      </TableHeader>
                      <TableBody>
                        {group.items.map((e) => (
                          <ExpenseRow key={e.id} expense={e} accessToken={accessToken} locked={isClosed} onChanged={load} />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {dashboard && dashboard.totals.unpaidChargesCount > 0 && (
          <Card className="border-warning-border bg-warning/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-warning text-white">
                  <Droplets size={14} />
                </span>
                <CardTitle>Charges SONEB & SBEE impayées</CardTitle>
              </div>
              <CardDescription>Toutes factures en attente de règlement, quelle que soit leur date de facturation.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {dashboard.unpaidChargesByType.map((u) => (
                  <div key={u.utilityType} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                    <span className="text-body-sm text-ink">{UTILITY_TYPE_LABELS[u.utilityType]}</span>
                    <span className="tabular font-currency-table text-ink">{formatFcfa(u.total)} ({u.count})</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="font-label-md text-ink">Total impayé</span>
                <span className="tabular font-currency-table text-headline-sm text-warning-fg">
                  {formatFcfa(dashboard.totals.unpaidCharges)}
                </span>
              </div>
              <Link href="/espace/charges" className="self-start">
                <Button variant="secondary" size="sm">Voir le registre des charges</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {closedPeriods && closedPeriods.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Historique des clôtures</CardTitle>
              <CardDescription>Mois déjà clôturés, pour la traçabilité des recettes.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {closedPeriods.map((p) => (
                <div key={p.period} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <span className="inline-flex items-center gap-2 font-label-md text-ink">
                    {p.period}
                    {p.forced && <Badge variant="warning">Clôture anticipée</Badge>}
                  </span>
                  <span className="text-body-xs text-ink-muted">
                    Clôturé le {p.closedAt.slice(0, 10)}
                    {p.closedBy ? ` par ${p.closedBy.name} (${p.closedBy.roleLabel})` : ""}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {isDg && <DeletedEntriesSection accessToken={accessToken} />}
      </div>
    </div>
  );
}

function DeletedEntriesSection({ accessToken }: { accessToken: string | null }) {
  const [entries, setEntries] = React.useState<DeletedEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    listDeletedEntries(accessToken)
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le journal des suppressions."));
  }, [accessToken]);

  if (entries !== null && entries.length === 0) return null;

  return (
    <Card className="border-danger-border/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <History size={16} className="text-danger-fg" />
          <CardTitle>Journal des suppressions</CardTitle>
        </div>
        <CardDescription>
          Dépenses et charges SONEB/SBEE supprimées par la comptabilité ou les agents, visibles du DG uniquement,
          exclues des totaux, avec justification obligatoire.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        {entries === null ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Élément</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Créé par</TableHead>
                <TableHead>Supprimé par</TableHead>
                <TableHead>Le</TableHead>
                <TableHead>Justification</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={`${e.type}-${e.id}`}>
                  <TableCell>
                    <Badge variant="neutral">{e.type === "expense" ? "Dépense" : "Charge"}</Badge>{" "}
                    <span className="text-ink">{e.label}</span>
                    <div className="text-body-xs text-ink-muted">{e.date}</div>
                  </TableCell>
                  <TableAmount>{formatFcfa(e.amount)}</TableAmount>
                  <TableCell className="text-ink-soft">
                    {e.createdBy ? `${e.createdBy.name} (${e.createdBy.roleLabel})` : "—"}
                  </TableCell>
                  <TableCell className="text-ink-soft">
                    {e.deletedBy ? `${e.deletedBy.name} (${e.deletedBy.roleLabel})` : "—"}
                  </TableCell>
                  <TableCell className="text-ink-soft">{e.deletedAt.slice(0, 10)}</TableCell>
                  <TableCell className="text-ink-soft">{e.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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
      await closePeriod(accessToken, yearMonth, force);
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

// Chaque carte reprend la teinte de son statut réel (vert = favorable, rouge
// = défavorable, orange = à surveiller) — la couleur porte l'information,
// jamais seule (icône + libellé toujours présents), tokens Badge/charte.
function DashboardCards({ dashboard }: { dashboard: AccountingDashboard }) {
  const { totals } = dashboard;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        label="Loyers encaissés"
        icon={<TrendingUp size={16} />}
        value={formatFcfa(totals.rentCollected)}
        tone={totals.rentCollected > 0 ? "success" : "default"}
        trend={{ value: `${totals.rentCollectedCount} paiement(s)`, direction: "flat" }}
      />
      <StatCard
        label="Versé aux propriétaires"
        icon={<TrendingDown size={16} />}
        value={formatFcfa(totals.ownerPayouts)}
        tone={totals.ownerPayouts > 0 ? "success" : "default"}
        trend={{ value: `${totals.ownerPayoutsCount} versement(s)`, direction: "flat" }}
      />
      <StatCard
        label="Dépenses du cabinet"
        icon={<Wallet size={16} />}
        value={formatFcfa(totals.expenses)}
        tone={totals.expenses > 0 ? "warning" : "default"}
        trend={{ value: `${totals.expensesCount} dépense(s)`, direction: "flat" }}
      />
      <StatCard
        label="Travaux facturés aux biens"
        icon={<Wallet size={16} />}
        value={formatFcfa(totals.propertyExpenses)}
        tone="info"
        trend={{ value: `${totals.propertyExpensesCount} dépense(s), à la charge des propriétaires`, direction: "flat" }}
      />
      <StatCard
        label="Impayés SONEB/SBEE"
        icon={<Droplets size={16} />}
        value={formatFcfa(totals.unpaidCharges)}
        tone={totals.unpaidChargesCount > 0 ? "danger" : "success"}
        trend={{ value: `${totals.unpaidChargesCount} facture(s)`, direction: "flat" }}
      />
      <StatCard
        label="Impayés locataires"
        icon={<AlertTriangle size={16} />}
        value={formatFcfa(totals.tenantArrears)}
        tone={totals.tenantArrearsCount > 0 ? "danger" : "success"}
        trend={{ value: `${totals.tenantArrearsCount} locataire(s) en retard`, direction: "flat" }}
      />
      <StatCard
        label="Solde net"
        icon={<Scale size={16} />}
        value={formatFcfa(totals.netCashFlow)}
        tone={totals.netCashFlow >= 0 ? "success" : "danger"}
        trend={{ value: "Encaissé, moins reversé et dépenses du cabinet", direction: totals.netCashFlow >= 0 ? "up" : "down" }}
      />
    </div>
  );
}

function ExpenseForm({
  accessToken,
  onCreated,
}: {
  accessToken: string | null;
  onCreated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<ExpenseCategory>("autre");
  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");
  // Toujours ancrée sur aujourd'hui (mois actuellement ouvert), jamais sur
  // le mois historique éventuellement consulté via le sélecteur de période.
  const [expenseDate, setExpenseDate] = React.useState(todayIso());
  const [method, setMethod] = React.useState<PaymentMethod>("especes");
  const [notes, setNotes] = React.useState("");
  const [receipt, setReceipt] = React.useState<File | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await createExpense(accessToken, {
        category,
        label: label.trim(),
        amount: Number(amount),
        expenseDate,
        paymentMethod: method,
        notes: notes.trim() || undefined,
        receipt: receipt ?? undefined,
      });
      setOpen(false);
      setLabel("");
      setAmount("");
      setNotes("");
      setReceipt(null);
      onCreated();
      toast.success("Dépense enregistrée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette dépense.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Nouvelle dépense</span>
        <Button variant="info" size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} />
          {open ? "Fermer" : "Enregistrer une dépense"}
        </Button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Libellé" htmlFor="expLabel" required hint="Ex. Loyer bureau, papeterie...">
              <Input id="expLabel" value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Montant (FCFA)" htmlFor="expAmount" required>
              <Input id="expAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Catégorie" htmlFor="expCategory" required>
              <select
                id="expCategory"
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {CATEGORIES.map(([key, l]) => (
                  <option key={key} value={key}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor="expDate" required>
              <Input id="expDate" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mode de règlement" htmlFor="expMethod" required>
              <select
                id="expMethod"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Justificatif (optionnel)" htmlFor="expReceipt" hint="PNG, JPEG, WEBP ou PDF, 5 Mo max">
              <input
                id="expReceipt"
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
                className="text-body-sm text-ink-soft file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:font-label-sm file:text-ink"
              />
            </Field>
          </div>
          <Field label="Note (optionnel)" htmlFor="expNotes">
            <Input id="expNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button type="submit" disabled={submitting || !label.trim() || !amount} className="self-start">
            {submitting ? "Enregistrement…" : "Enregistrer la dépense"}
          </Button>
        </form>
      )}
    </div>
  );
}

function ExpenseRow({
  expense,
  accessToken,
  locked,
  onChanged,
}: {
  expense: Expense;
  accessToken: string | null;
  locked: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleteReason, setDeleteReason] = React.useState("");
  const [label, setLabel] = React.useState(expense.label);
  const [amount, setAmount] = React.useState(String(expense.amount));
  const [category, setCategory] = React.useState<ExpenseCategory>(expense.category);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSave() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateExpense(accessToken, expense.id, {
        label: label.trim(),
        amount: Number(amount),
        category,
      });
      setEditing(false);
      onChanged();
      toast.success("Dépense modifiée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!accessToken || deleteReason.trim().length < 5) return;
    setSubmitting(true);
    try {
      await deleteExpense(accessToken, expense.id, deleteReason.trim());
      onChanged();
      toast.info("Dépense supprimée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de supprimer.");
      setSubmitting(false);
      setConfirmDelete(false);
    }
  }

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={8}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Libellé" />
              <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="Montant" />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink"
              >
                {CATEGORIES.map(([key, l]) => (
                  <option key={key} value={key}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={submitting}>Enregistrer</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={submitting}>Annuler</Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (confirmDelete) {
    return (
      <TableRow>
        <TableCell colSpan={8}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <p className="text-body-sm text-ink">
              Supprimer « {expense.label} » ({formatFcfa(expense.amount)}) ? Une justification est obligatoire. La
              suppression restera tracée et visible du DG, mais sortira des totaux.
            </p>
            <Field label="Justification" htmlFor={`delReason-${expense.id}`} required hint="5 caractères minimum">
              <Input
                id={`delReason-${expense.id}`}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Ex. Doublon avec la dépense du..."
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={submitting || deleteReason.trim().length < 5}
              >
                {submitting ? "Suppression…" : "Confirmer la suppression"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setConfirmDelete(false); setDeleteReason(""); }}
                disabled={submitting}
              >
                Annuler
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="text-ink-soft">{formatTimeOfDay(expense.createdAt)}</TableCell>
      <TableCell className="text-ink-soft">{expense.expenseDate}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="text-ink">{expense.label}</span>
          {expense.propertyCode && (
            <Badge variant="info" title="Travaux facturés à ce Bien, à la charge du propriétaire, pas du cabinet">
              {expense.propertyCode}
            </Badge>
          )}
        </div>
        {expense.notes && <div className="text-body-xs text-ink-muted">{expense.notes}</div>}
      </TableCell>
      <TableCell className="text-ink-soft">{EXPENSE_CATEGORY_LABELS[expense.category]}</TableCell>
      <TableAmount>{formatFcfa(expense.amount)}</TableAmount>
      <TableCell className="text-ink-soft">{expense.paymentMethodLabel}</TableCell>
      <TableCell className="text-ink-soft">
        {expense.recordedBy ? `${expense.recordedBy.name} (${expense.recordedBy.roleLabel})` : "—"}
      </TableCell>
      <TableCell className="text-right">
        {locked ? (
          <Badge variant="neutral">
            <Lock size={11} /> Clôturé
          </Badge>
        ) : (
          <div className="flex items-center justify-end gap-1">
            {expense.receiptUrl && (
              <a href={`${API_URL}${expense.receiptUrl}`} target="_blank" rel="noopener noreferrer" aria-label="Voir le justificatif">
                <Button variant="ghost" size="sm"><FileDown size={14} /></Button>
              </a>
            )}
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label="Modifier">
              <Pencil size={14} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label="Supprimer">
              <Trash2 size={14} className="text-danger-fg" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
