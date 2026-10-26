"use client";



import * as React from "react";
import Link from "next/link";
import {
  Droplets,
  Zap,
  AlertTriangle,
  Lock,
  FileDown,
  FileSpreadsheet,
  Landmark,
  Percent,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { useCan } from "@/lib/auth/use-can";
import { ApiError, openAuthenticatedPdf, downloadAuthenticatedFile } from "@/lib/api/client";
import {
  listExpenses,
  getDashboard,
  accountingReportPdfPath,
  accountingExportXlsxPath,
  listRentPayments,
  listOwnerPayouts,
  type Expense,
  type AccountingDashboard,
  type CardKey,
  type RentPaymentEntry,
  type OwnerPayoutEntry,
} from "@/lib/api/accounting";
import { UTILITY_TYPE_LABELS } from "@/lib/constants/charges";
import { formatFcfa, formatDateHeading, cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import {
  MonthGroupsToolbar,
  MonthHeaderRow,
  countLabel,
  useMonthGroups,
} from "@/components/ui/month-group";
import { RentMonthCard } from "@/components/accounting/rent-month-card";
import { OtherIncomesCard } from "@/components/accounting/other-incomes-card";
import { sumBy } from "@/lib/group-by-month";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { CardDetailDialog } from "@/components/accounting/card-detail-dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
} from "@/components/ui/table";
import { DashboardCards } from "./sections/dashboard-cards";
import { DeletedEntriesSection } from "./sections/deleted-entries-section";
import { ExpenseForm } from "./sections/expense-form";
import { ExpenseRow } from "./sections/expense-row";
import { FixedAssetsSection } from "./sections/fixed-assets";
import { currentYearMonth, monthRange } from "./sections/shared";

export function ComptabiliteView() {
  return (
    <RequireAuth permission="comptabilite">
      <ComptabiliteContent />
    </RequireAuth>
  );
}

// Regroupement par mois (fonctions de module : stables entre les rendus) — les paiements
// de loyer par MOIS DE LOYER concerné, les versements par mois de règlement.
const rentPaymentMonth = (p: RentPaymentEntry) => p.coversMonth;
const ownerPayoutMonth = (p: OwnerPayoutEntry) => p.paidAt;

function ComptabiliteContent() {
  const canRecordExpense = useCan("depenses_enregistrer");
  const { accessToken, user } = useAuth();
  const isDg = user?.role === "dg";
  const [yearMonth, setYearMonth] = React.useState(currentYearMonth());
  const { from, to } = monthRange(yearMonth);

  const [dashboard, setDashboard] = React.useState<AccountingDashboard | null>(null);
  const [expenses, setExpenses] = React.useState<Expense[] | null>(null);
  const [rentPayments, setRentPayments] = React.useState<RentPaymentEntry[] | null>(null);
  const [ownerPayouts, setOwnerPayouts] = React.useState<OwnerPayoutEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [exportingXlsx, setExportingXlsx] = React.useState(false);
  const [openCard, setOpenCard] = React.useState<CardKey | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    Promise.all([
      getDashboard(accessToken, from, to),
      listExpenses(accessToken, { from, to }),
      listRentPayments(accessToken, from, to),
      listOwnerPayouts(accessToken, from, to),
    ])
      .then(([dash, exp, rp, op]) => {
        setDashboard(dash);
        setExpenses(exp.expenses);
        setRentPayments(rp.payments);
        setOwnerPayouts(op.payouts);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la comptabilité."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, from, to]);

  React.useEffect(() => load(), [load]);

  // Lien "Dépenses" du menu (`#depenses`) : la navigation native vers l'ancre échoue souvent, la section
  // n'existant pas encore dans le DOM au moment où le navigateur essaie de défiler (chargement encore en
  // cours) — retenté ici une fois les dépenses effectivement affichées.
  React.useEffect(() => {
    if (expenses === null) return;
    if (window.location.hash !== '#depenses') return;
    document.getElementById('depenses')?.scrollIntoView({ block: 'start' });
  }, [expenses]);

  const isClosed = dashboard?.isClosed ?? false;

  // Regroupe le journal par jour de SAISIE (préfixe de `createdAt`, pas
  // `expenseDate`) : l'ordre reçu du back-end est déjà décroissant sur ce
  // même champ, donc chaque groupe hérite naturellement du bon ordre interne.
  const rentGroups = useMonthGroups(rentPayments, rentPaymentMonth);
  const payoutGroups = useMonthGroups(ownerPayouts, ownerPayoutMonth);

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
            <p className="text-body-md text-ink-soft">Recettes et dépenses de l&apos;entreprise, classées par nature, mois par mois.</p>
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

        <RentMonthCard yearMonth={yearMonth} />

        {dashboard && <DashboardCards dashboard={dashboard} onOpen={setOpenCard} />}

        <CardDetailDialog card={openCard} initialMonth={yearMonth} accessToken={accessToken} onClose={() => setOpenCard(null)} />

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
                    {a.unpaidMonths > 0 && (
                      <p className="text-body-xs text-ink-muted">
                        {a.daysLate} j de retard · {a.unpaidMonths} mois dû(s)
                      </p>
                    )}
                    {a.openingDebtRemaining > 0 && (
                      <p className="text-body-xs text-warning-fg">Impayés à l&apos;entrée : {formatFcfa(a.openingDebtRemaining)}</p>
                    )}
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

        {dashboard && dashboard.ownersWithoutCommissionRate.length > 0 && (
          <Card className="border-danger-border bg-danger/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-danger text-white">
                  <Percent size={14} />
                </span>
                <CardTitle>Propriétaires sans taux de commission défini</CardTitle>
              </div>
              <CardDescription>
                Ces propriétaires ont déjà des loyers encaissés, mais aucun taux n&apos;a jamais été défini pour
                eux — 0 % de commission a été appliqué en silence. Ouvrez leur fiche pour en définir un.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {dashboard.ownersWithoutCommissionRate.map((o) => (
                <Link
                  key={o.ownerId}
                  href={`/espace/proprietaires/${o.ownerId}`}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-surface-muted"
                >
                  <p className="font-label-md text-ink">{o.ownerName}</p>
                  <span className="tabular font-currency-table text-danger-fg">{formatFcfa(o.totalCollected)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {dashboard && dashboard.escrow.byOwner.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Landmark size={14} />
                </span>
                <CardTitle>Comptes séquestres par mandat</CardTitle>
              </div>
              <CardDescription>
                Ce que l&apos;entreprise détient actuellement pour chaque propriétaire (recette nette cumulée depuis
                toujours, moins les versements déjà effectués) — pas borné à la période sélectionnée ci-dessus.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {dashboard.escrow.byOwner.map((o) => (
                <Link
                  key={o.ownerId}
                  href={`/espace/proprietaires/${o.ownerId}`}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-surface-muted"
                >
                  <p className="font-label-md text-ink">{o.ownerName}</p>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={cn("tabular font-currency-table", o.balance < 0 ? "text-danger-fg" : "text-ink")}>
                      {formatFcfa(o.balance)}
                    </span>
                    {/* Jamais mélangé au solde ci-dessus (décision explicite) : de
                        l'argent pas encore réellement collecté. */}
                    {o.openingDebtUnpaid > 0 && (
                      <span className="tabular text-body-xs text-warning-fg">
                        + {formatFcfa(o.openingDebtUnpaid)} impayé
                      </span>
                    )}
                  </div>
                </Link>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
                <span className="font-label-md text-ink">Total détenu pour les propriétaires</span>
                <span className="tabular font-currency-table text-headline-sm text-ink">
                  {formatFcfa(dashboard.escrow.total)}
                </span>
              </div>
              {dashboard.escrow.openingDebtUnpaidTotal > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-body-sm text-ink-soft">Dont impayés à l&apos;entrée (non compris ci-dessus)</span>
                  <span className="tabular text-body-sm text-warning-fg">
                    {formatFcfa(dashboard.escrow.openingDebtUnpaidTotal)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Un fond teinté par registre (vert = encaissé, bleu = reversé, orange = dépensé) : les
            trois listes se suivent à l'écran et se ressemblaient trop, difficile de savoir dans
            laquelle on se trouve d'un coup d'œil. */}
        <Card className="border-success-border bg-success/5">
          <CardHeader>
            <CardTitle>Paiements des locataires</CardTitle>
            <CardDescription>
              Loyers encaissés sur la période sélectionnée, regroupés par mois de loyer concerné.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rentPayments === null ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : rentPayments.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucun paiement de loyer sur cette période.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <MonthGroupsToolbar count={rentGroups.groups.length} allOpen={rentGroups.allOpen} onSetAll={rentGroups.setAll} />
                <Table>
                  <TableHeader>
                    <tr>
                      <TableHead>Locataire</TableHead>
                      <TableHead>Unité</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Enregistré par</TableHead>
                    </tr>
                  </TableHeader>
                  {rentGroups.groups.map((g, i) => {
                    const open = rentGroups.isOpen(g.month, i);
                    return (
                      <TableBody key={g.month || "sans-date"}>
                        <MonthHeaderRow
                          colSpan={6}
                          noun="Loyer"
                          month={g.month}
                          open={open}
                          onToggle={() => rentGroups.toggle(g.month, i)}
                          summary={
                            <>
                              {countLabel(g.items.length, "paiement")} ·{" "}
                              <span className="tabular font-label-md text-ink">{formatFcfa(sumBy(g.items, (p) => p.amount))}</span>
                            </>
                          }
                        />
                        {open &&
                          g.items.map((p) => (
                            <TableRow key={p.id}>
                              <TableCell>{p.renter.firstName} {p.renter.lastName}</TableCell>
                              <TableCell className="text-ink-soft">{p.unitCode}</TableCell>
                              <TableAmount>{formatFcfa(p.amount)}</TableAmount>
                              <TableCell className="text-ink-soft">{p.paymentMethodLabel}</TableCell>
                              <TableCell className="text-ink-soft">{p.paidAt}</TableCell>
                              <TableCell className="text-ink-soft">
                                {p.recordedBy ? `${p.recordedBy.name} (${p.recordedBy.roleLabel})` : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    );
                  })}
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-info-border bg-info/5">
          <CardHeader>
            <CardTitle>Versements aux propriétaires</CardTitle>
            <CardDescription>Loyers nets reversés sur la période sélectionnée, regroupés par mois de règlement.</CardDescription>
          </CardHeader>
          <CardContent>
            {ownerPayouts === null ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : ownerPayouts.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucun versement propriétaire sur cette période.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <MonthGroupsToolbar count={payoutGroups.groups.length} allOpen={payoutGroups.allOpen} onSetAll={payoutGroups.setAll} />
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
                  {payoutGroups.groups.map((g, i) => {
                    const open = payoutGroups.isOpen(g.month, i);
                    return (
                      <TableBody key={g.month || "sans-date"}>
                        <MonthHeaderRow
                          colSpan={6}
                          noun="Versements"
                          month={g.month}
                          open={open}
                          onToggle={() => payoutGroups.toggle(g.month, i)}
                          summary={
                            <>
                              {countLabel(g.items.length, "versement")} ·{" "}
                              <span className="tabular font-label-md text-ink">{formatFcfa(sumBy(g.items, (p) => p.amount))}</span>
                            </>
                          }
                        />
                        {open &&
                          g.items.map((p) => (
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
                    );
                  })}
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="depenses" className="border-warning-border bg-warning/5">
          <CardHeader>
            <CardTitle>Journal des dépenses</CardTitle>
            <CardDescription>
              Dépenses de la période sélectionnée : une dépense payée apparaît au mois où l&apos;argent est sorti, une dépense à crédit encore impayée à sa date de saisie. Les travaux facturés à un Bien
              (repérés par son code ci-dessous) sont à la charge du propriétaire et n&apos;entrent pas dans les
              totaux de l&apos;entreprise.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {isClosed ? (
              <p className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm text-ink-muted">
                <Lock size={14} /> Mois clôturé, aucune nouvelle dépense ne peut être ajoutée.
              </p>
            ) : canRecordExpense ? (
              <ExpenseForm accessToken={accessToken} onCreated={load} />
            ) : null}

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

        <OtherIncomesCard accessToken={accessToken} from={from} to={to} isClosed={isClosed} onChanged={load} />

        <FixedAssetsSection accessToken={accessToken} />

        {dashboard && dashboard.totals.unpaidChargesCount > 0 && (
          <Card className="border-warning-border">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warning-strong text-white shadow-sm">
                    <Droplets size={16} />
                  </span>
                  <CardTitle>Charges SONEB &amp; SBEE impayées</CardTitle>
                </div>
                <Badge variant="warning" dot>
                  {dashboard.totals.unpaidChargesCount} impayée{dashboard.totals.unpaidChargesCount > 1 ? "s" : ""}
                </Badge>
              </div>
              <CardDescription>Toutes factures en attente de règlement, quelle que soit leur date de facturation.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2">
                {dashboard.unpaidChargesByType.map((u) => (
                  <StatCard
                    key={u.utilityType}
                    label={`${UTILITY_TYPE_LABELS[u.utilityType]} · ${u.count} facture${u.count > 1 ? "s" : ""}`}
                    value={formatFcfa(u.total, { withSuffix: false })}
                    unit="FCFA"
                    icon={u.utilityType === "soneb" ? <Droplets size={16} /> : <Zap size={16} />}
                    tone="warning"
                  />
                ))}
              </div>

              <div className="flex items-center justify-between rounded-xl bg-ink px-4 py-3.5 text-white shadow-sm">
                <span className="font-label-sm uppercase tracking-wider text-white/80">Total impayé</span>
                <span className="tabular font-display text-headline-md tracking-tight text-white">
                  {formatFcfa(dashboard.totals.unpaidCharges)}
                </span>
              </div>

              <Link
                href="/espace/charges"
                className="group inline-flex w-fit items-center gap-2 self-start rounded-lg border border-border px-3.5 py-2 text-body-sm font-semibold text-ink transition-colors hover:border-primary/30 hover:bg-surface-hover"
              >
                Voir le registre des charges
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </CardContent>
          </Card>
        )}

        {isDg && <DeletedEntriesSection accessToken={accessToken} />}
      </div>
    </div>
  );
}

