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
  Landmark,
  Smartphone,
  Scale,
  CalendarRange,
  Settings2,
  Bell,
  Plus,
  Trash2,
  Undo2,
  Lock,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  Banknote,
  CircleCheck,
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf, downloadAuthenticatedFile } from "@/lib/api/client";
import {
  listGlAccounts,
  listGlJournals,
  listGlFiscalYears,
  createGlFiscalYear,
  closeGlFiscalYear,
  listGlPostingRules,
  updateGlPostingRule,
  resyncGlPostingRules,
  renameGlSystemAccount,
  getGlSettings,
  updateGlSettings,
  getIrfBalance,
  payIrf,
  type GlSettings,
  listGlEntries,
  getGlEntry,
  createManualGlEntry,
  extourneGlEntry,
  getTrialBalance,
  getGeneralLedger,
  getThirdPartyBalance,
  listGlNotifications,
  markGlNotificationRead,
  markAllGlNotificationsRead,
  getIncomeStatement,
  getBalanceSheet,
  getCashFlow,
  financialStatementsPdfPath,
  financialStatementsXlsxPath,
  getGlActivationStatus,
  getMandantsCabinetIndicator,
  type MandantsCabinetIndicator,
  listBankReconciliations,
  startBankReconciliation,
  updateBankReconciliationStatement,
  getBankReconciliation,
  pointBankMovement,
  addBankOnlyLine,
  removeBankReconciliationLine,
  finalizeBankReconciliation,
  type GlActivationStatus,
  type BankReconciliation,
  type BankReconciliationDetail,
  type IncomeStatement,
  type BalanceSheet,
  type CashFlowStatement,
  type GlAccount,
  type GlJournal,
  type GlFiscalYear,
  type GlPostingRule,
  type GlEntry,
  type GlEntryLine,
  type CreateManualEntryLineInput,
  type TrialBalanceLine,
  type GeneralLedgerMovement,
  type ThirdPartyType,
  type ThirdPartyBalanceLine,
  type GlNotification,
} from "@/lib/api/gl";
import type { PaymentMethod } from "@/lib/api/renters";
import { formatFcfa, formatDateLabel } from "@/lib/utils";
import { RENAMEABLE_SYSTEM_ACCOUNTS } from "@/lib/constants/glRenameableAccounts";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const SELECT_CLASS =
  "h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

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

function DashboardTab({
  accessToken,
  isDg,
  openFiscalYear,
}: {
  accessToken: string | null;
  isDg: boolean;
  openFiscalYear: GlFiscalYear | null;
}) {
  const [lines, setLines] = React.useState<TrialBalanceLine[] | null>(null);
  const [indicator, setIndicator] = React.useState<MandantsCabinetIndicator | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken || !openFiscalYear) return;
    getTrialBalance(accessToken, openFiscalYear.id)
      .then((res) => setLines(res.lines))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la trésorerie."));
  }, [accessToken, openFiscalYear]);

  // Cumulé depuis toujours (pas borné à l'exercice ouvert, contrairement à
  // la balance générale ci-dessus) — chargé indépendamment.
  React.useEffect(() => {
    if (!accessToken) return;
    getMandantsCabinetIndicator(accessToken)
      .then(setIndicator)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger l'indicateur mandants/cabinet."));
  }, [accessToken]);

  const byCode = (code: string) => lines?.find((l) => l.code === code)?.balance ?? 0;
  const resultLines = lines?.filter((l) => l.accountType === "charge" || l.accountType === "produit") ?? [];
  const produits = resultLines.filter((l) => l.accountType === "produit").reduce((s, l) => s - l.balance, 0);
  const charges = resultLines.filter((l) => l.accountType === "charge").reduce((s, l) => s + l.balance, 0);

  return (
    <div className="flex flex-col gap-5">
      {!openFiscalYear && (
        <p className="rounded-lg border border-warning-border bg-warning-bg p-3 text-body-sm text-warning-fg">
          Aucun exercice comptable ouvert — ouvrez-en un dans l&apos;onglet « Exercices » pour commencer à
          enregistrer des écritures.
        </p>
      )}
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}

      {openFiscalYear && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Caisse (571)" icon={<Wallet size={16} />} value={formatFcfa(byCode("571"))} />
          <StatCard label="Banque (521)" icon={<Landmark size={16} />} value={formatFcfa(byCode("521"))} />
          <StatCard label="Mobile Money (552)" icon={<Smartphone size={16} />} value={formatFcfa(byCode("552"))} />
          <StatCard
            label="Résultat (produits − charges)"
            icon={<Scale size={16} />}
            value={formatFcfa(produits - charges)}
            tone={produits - charges >= 0 ? "success" : "danger"}
          />
        </div>
      )}

      {indicator && <MandantsCabinetCard indicator={indicator} />}
      <IrfBalanceCard accessToken={accessToken} />

      {isDg && <NotificationsPanel accessToken={accessToken} />}
    </div>
  );
}

// Séparation des fonds mandants/cabinet : la trésorerie réelle doit
// toujours couvrir ce qui est détenu pour le compte de tiers (propriétaires
// en attente de reversement + cautions locataires non restituées) — sinon
// le cabinet a puisé dans de l'argent qui ne lui appartient pas.
function MandantsCabinetCard({ indicator }: { indicator: MandantsCabinetIndicator }) {
  const isCovered = indicator.coverage >= 0;
  return (
    <Card className={isCovered ? "border-success-border bg-success/5" : "border-danger-border bg-danger/5"}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-white ${isCovered ? "bg-success" : "bg-danger"}`}>
            {isCovered ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}
          </span>
          <CardTitle>Séparation des fonds — mandants / cabinet</CardTitle>
        </div>
        <CardDescription>
          Vérifie que la trésorerie réelle du cabinet couvre bien ce qu&apos;il détient pour le compte de tiers :
          loyers nets déjà encaissés mais pas encore reversés aux propriétaires, et cautions locataires pas encore
          restituées.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border px-3 py-2.5">
            <p className="text-body-xs text-ink-muted">Trésorerie totale (caisse + banque + mobile money)</p>
            <p className="tabular font-currency-table text-ink">{formatFcfa(indicator.treasury.total)}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2.5">
            <p className="text-body-xs text-ink-muted">Fonds détenus pour des tiers</p>
            <p className="tabular font-currency-table text-ink">{formatFcfa(indicator.fundsHeldForThirdParties)}</p>
            <p className="text-body-xs text-ink-muted">
              {formatFcfa(indicator.dueToOwners)} dû aux propriétaires · {formatFcfa(indicator.depositsHeld)} de cautions
            </p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2.5">
            <p className="text-body-xs text-ink-muted">Écart de couverture</p>
            <p className={`tabular font-currency-table ${isCovered ? "text-success-fg" : "text-danger-fg"}`}>
              {formatFcfa(indicator.coverage)}
            </p>
          </div>
        </div>
        <p className={`text-body-sm ${isCovered ? "text-success-fg" : "text-danger-fg"}`}>
          {isCovered
            ? "La trésorerie couvre entièrement les fonds détenus pour le compte de tiers."
            : `La trésorerie est insuffisante de ${formatFcfa(Math.abs(indicator.coverage))} pour couvrir les fonds détenus pour le compte de tiers — vérifiez les dépenses récentes.`}
        </p>
      </CardContent>
    </Card>
  );
}

const NOTIF_LABELS: Record<string, string> = {
  entry_reversed: "Écriture extournée",
  manual_entry: "Écriture manuelle",
  fiscal_year_closed: "Exercice clôturé",
  expense_threshold: "Dépense au-dessus du seuil",
  monthly_rent_digest: "Résumé mensuel des loyers",
  daily_arrears_digest: "Relances du jour",
  balance_imbalance_alert: "Alerte de balance",
  closing_reminder: "Rappel de clôture",
};

function NotificationsPanel({ accessToken }: { accessToken: string | null }) {
  const [notifications, setNotifications] = React.useState<GlNotification[] | null>(null);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listGlNotifications(accessToken).then((res) => {
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    });
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function handleRead(id: number) {
    if (!accessToken) return;
    await markGlNotificationRead(accessToken, id);
    load();
  }

  async function handleReadAll() {
    if (!accessToken) return;
    await markAllGlNotificationsRead(accessToken);
    toast.info("Notifications marquées comme lues.");
    load();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bell size={18} />
            Notifications
            {unreadCount > 0 && <Badge variant="danger">{unreadCount} non lue(s)</Badge>}
          </CardTitle>
          <CardDescription>Actions sensibles et résumés automatiques adressés au DG.</CardDescription>
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={handleReadAll}>
            Tout marquer comme lu
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!notifications ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : notifications.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucune notification.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
                  n.readAt ? "border-border bg-surface" : "border-primary-border bg-primary-bg"
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-label-sm uppercase tracking-wider text-ink-muted">
                    {NOTIF_LABELS[n.type] ?? n.type}
                  </span>
                  <span className="text-body-sm text-ink">{n.message}</span>
                  <span className="text-body-xs text-ink-faint">{formatDateLabel(n.createdAt.slice(0, 10))}</span>
                </div>
                {!n.readAt && (
                  <Button variant="ghost" size="sm" onClick={() => handleRead(n.id)}>
                    <CheckCircle2 size={14} />
                    Lu
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Journal ──────────────────────────────────────────────────────────────

function JournalTab({
  accessToken,
  accounts,
  journals,
  openFiscalYear,
}: {
  accessToken: string | null;
  accounts: GlAccount[];
  journals: GlJournal[];
  openFiscalYear: GlFiscalYear | null;
}) {
  const [entries, setEntries] = React.useState<GlEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<number | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listGlEntries(accessToken)
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le journal."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  return (
    <div className="flex flex-col gap-4">
      <ManualEntryForm
        accessToken={accessToken}
        accounts={accounts}
        journals={journals}
        openFiscalYear={openFiscalYear}
        onCreated={load}
      />

      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      {!entries ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : entries.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Aucune écriture pour l&apos;instant.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N°</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Journal</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                accessToken={accessToken}
                expanded={expandedId === e.id}
                onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
                onChanged={load}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

const STATUS_BADGE: Record<GlEntry["status"], { label: string; variant: "success" | "neutral" | "warning" }> = {
  validee: { label: "Validée", variant: "success" },
  brouillon: { label: "Brouillon", variant: "neutral" },
  extournee: { label: "Extournée", variant: "warning" },
};

function EntryRow({
  entry,
  accessToken,
  expanded,
  onToggle,
  onChanged,
}: {
  entry: GlEntry;
  accessToken: string | null;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [lines, setLines] = React.useState<GlEntryLine[] | null>(null);
  const [showExtourne, setShowExtourne] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(todayIso());
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (!expanded || !accessToken || lines) return;
    getGlEntry(accessToken, entry.id).then((res) => setLines(res.lines));
  }, [expanded, accessToken, entry.id, lines]);

  async function handleExtourne(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await extourneGlEntry(accessToken, entry.id, { entryDate, reason: reason.trim() });
      toast.success(`Écriture n°${entry.entryNumber} extournée.`);
      setShowExtourne(false);
      setReason("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'extourner cette écriture.");
    } finally {
      setSubmitting(false);
    }
  }

  const canReverse = entry.status === "validee";
  const badge = STATUS_BADGE[entry.status];

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="tabular">{entry.entryNumber}</TableCell>
        <TableCell>{formatDateLabel(entry.entryDate)}</TableCell>
        <TableCell>{entry.journal.code}</TableCell>
        <TableCell>{entry.narration}</TableCell>
        <TableCell>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </TableCell>
        <TableCell>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="!bg-surface-muted">
          <TableCell colSpan={6}>
            <div className="flex flex-col gap-3 py-2">
              {!lines ? (
                <p className="text-body-sm text-ink-muted">Chargement…</p>
              ) : (
                <table className="w-full text-body-sm">
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-3">
                          {l.accountCode} — {l.accountLabel}
                          {l.thirdParty && <span className="text-ink-faint"> ({l.thirdParty.name})</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular">{l.side === "debit" ? formatFcfa(l.amount) : ""}</td>
                        <td className="py-1.5 text-right tabular">{l.side === "credit" ? formatFcfa(l.amount) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {canReverse && !showExtourne && (
                <Button
                  variant="warning"
                  size="sm"
                  className="self-start"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowExtourne(true);
                  }}
                >
                  <Undo2 size={14} />
                  Extourner cette écriture
                </Button>
              )}

              {showExtourne && (
                <form
                  onSubmit={handleExtourne}
                  onClick={(e) => e.stopPropagation()}
                  className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-bg p-3"
                >
                  <p className="text-body-sm text-warning-fg">
                    L&apos;extourne crée une écriture miroir qui annule celle-ci — irréversible, jamais de suppression
                    directe.
                  </p>
                  {error && <p className="text-body-sm text-danger-fg">{error}</p>}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Date de l'extourne" htmlFor={`extDate-${entry.id}`} required>
                      <Input id={`extDate-${entry.id}`} type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                    </Field>
                    <Field label="Justification" htmlFor={`extReason-${entry.id}`} required>
                      <Input id={`extReason-${entry.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" variant="warning" size="sm" disabled={submitting || reason.trim().length < 5}>
                      {submitting ? "Extourne en cours…" : "Confirmer l'extourne"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowExtourne(false)}>
                      Annuler
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ManualEntryForm({
  accessToken,
  accounts,
  journals,
  openFiscalYear,
  onCreated,
}: {
  accessToken: string | null;
  accounts: GlAccount[];
  journals: GlJournal[];
  openFiscalYear: GlFiscalYear | null;
  onCreated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  // Comptes de tiers exclus : pas de sélecteur de tiers dans ce formulaire de
  // saisie diverse (ils sont gérés automatiquement par les paiements/
  // versements habituels) — éviter un 400 déroutant côté serveur.
  const selectableAccounts = accounts.filter((a) => !a.isControlAccount && a.isActive);
  const odJournal = journals.find((j) => j.code === "OD") ?? journals[0] ?? null;

  const [journalId, setJournalId] = React.useState<number | null>(odJournal?.id ?? null);
  const [entryDate, setEntryDate] = React.useState(todayIso());
  const [narration, setNarration] = React.useState("");
  const [lines, setLines] = React.useState<CreateManualEntryLineInput[]>([
    { accountId: 0, side: "debit", amount: 0 },
    { accountId: 0, side: "credit", amount: 0 },
  ]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (journalId === null && odJournal) setJournalId(odJournal.id);
  }, [odJournal, journalId]);

  const totalDebit = lines.filter((l) => l.side === "debit").reduce((s, l) => s + (l.amount || 0), 0);
  const totalCredit = lines.filter((l) => l.side === "credit").reduce((s, l) => s + (l.amount || 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  function updateLine(i: number, patch: Partial<CreateManualEntryLineInput>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { accountId: 0, side: "debit", amount: 0 }]);
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !journalId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createManualGlEntry(accessToken, { journalId, entryDate, narration: narration.trim(), lines });
      toast.success("Écriture manuelle enregistrée.");
      setOpen(false);
      setNarration("");
      setLines([
        { accountId: 0, side: "debit", amount: 0 },
        { accountId: 0, side: "credit", amount: 0 },
      ]);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette écriture.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Saisie manuelle</span>
        <Button variant="info" size="sm" onClick={() => setOpen((v) => !v)} disabled={!openFiscalYear}>
          <Plus size={14} />
          {open ? "Fermer" : "Écriture diverse"}
        </Button>
      </div>
      {!openFiscalYear && <p className="text-body-xs text-ink-muted">Ouvrez un exercice pour saisir une écriture.</p>}

      {open && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Journal" htmlFor="mJournal" required>
              <select
                id="mJournal"
                value={journalId ?? ""}
                onChange={(e) => setJournalId(Number(e.target.value))}
                className={SELECT_CLASS}
              >
                {journals.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} — {j.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor="mDate" required>
              <Input id="mDate" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </Field>
            <Field label="Libellé" htmlFor="mNarration" required>
              <Input id="mNarration" value={narration} onChange={(e) => setNarration(e.target.value)} />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_140px_32px] sm:items-end">
                <Field label="Compte" htmlFor={`mAccount-${i}`}>
                  <select
                    id={`mAccount-${i}`}
                    value={line.accountId || ""}
                    onChange={(e) => updateLine(i, { accountId: Number(e.target.value) })}
                    className={SELECT_CLASS}
                  >
                    <option value="" disabled>
                      Choisir…
                    </option>
                    {selectableAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sens" htmlFor={`mSide-${i}`}>
                  <select
                    id={`mSide-${i}`}
                    value={line.side}
                    onChange={(e) => updateLine(i, { side: e.target.value as "debit" | "credit" })}
                    className={SELECT_CLASS}
                  >
                    <option value="debit">Débit</option>
                    <option value="credit">Crédit</option>
                  </select>
                </Field>
                <Field label="Montant" htmlFor={`mAmount-${i}`}>
                  <Input
                    id={`mAmount-${i}`}
                    inputMode="numeric"
                    value={line.amount || ""}
                    onChange={(e) => updateLine(i, { amount: Number(e.target.value.replace(/\D/g, "")) })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={lines.length <= 2}
                  onClick={() => removeLine(i)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={addLine}>
              <Plus size={14} />
              Ajouter une ligne
            </Button>
          </div>

          <p className={`text-body-sm ${balanced ? "text-success-fg" : "text-danger-fg"}`}>
            Débit {formatFcfa(totalDebit)} — Crédit {formatFcfa(totalCredit)}
            {!balanced && " (déséquilibrée)"}
          </p>

          <Button type="submit" disabled={submitting || !balanced || !narration.trim()} className="self-start">
            {submitting ? "Enregistrement…" : "Enregistrer l'écriture"}
          </Button>
        </form>
      )}
    </div>
  );
}

// ── Grand livre ────────────────────────────────────────────────────────────

function GrandLivreTab({ accessToken, accounts }: { accessToken: string | null; accounts: GlAccount[] }) {
  const [accountId, setAccountId] = React.useState<number | null>(null);
  const [movements, setMovements] = React.useState<GeneralLedgerMovement[] | null>(null);
  const [finalBalance, setFinalBalance] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken || !accountId) return;
    getGeneralLedger(accessToken, accountId)
      .then((res) => {
        setMovements(res.movements);
        setFinalBalance(res.finalBalance);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le grand livre."));
  }, [accessToken, accountId]);

  return (
    <div className="flex flex-col gap-4">
      <Field label="Compte" htmlFor="glAccount">
        <select
          id="glAccount"
          value={accountId ?? ""}
          onChange={(e) => setAccountId(Number(e.target.value) || null)}
          className={`${SELECT_CLASS} max-w-md`}
        >
          <option value="">Choisir un compte…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.label}
            </option>
          ))}
        </select>
      </Field>

      {error && <p className="text-body-sm text-danger-fg">{error}</p>}

      {accountId && movements && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>N°</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead>Tiers</TableHead>
                <TableHead className="text-right">Débit</TableHead>
                <TableHead className="text-right">Crédit</TableHead>
                <TableHead className="text-right">Solde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m, i) => (
                <TableRow key={i}>
                  <TableCell>{formatDateLabel(m.entryDate)}</TableCell>
                  <TableCell className="tabular">{m.entryNumber}</TableCell>
                  <TableCell>{m.narration}</TableCell>
                  <TableCell>{m.thirdPartyName ?? ""}</TableCell>
                  <TableAmount>{m.debit != null ? formatFcfa(m.debit) : ""}</TableAmount>
                  <TableAmount>{m.credit != null ? formatFcfa(m.credit) : ""}</TableAmount>
                  <TableAmount>{formatFcfa(m.runningBalance)}</TableAmount>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="self-end font-label-md text-ink">Solde final : {formatFcfa(finalBalance)}</p>
        </>
      )}
    </div>
  );
}

// ── Balance ─────────────────────────────────────────────────────────────

const THIRD_PARTY_TYPES: { value: ThirdPartyType; label: string }[] = [
  { value: "renter", label: "Locataires" },
  { value: "owner", label: "Propriétaires" },
  { value: "supplier", label: "Fournisseurs" },
  { value: "employee", label: "Employés" },
  { value: "other", label: "Autres" },
];

function BalanceTab({ accessToken, fiscalYears }: { accessToken: string | null; fiscalYears: GlFiscalYear[] }) {
  const [fiscalYearId, setFiscalYearId] = React.useState<number | null>(
    fiscalYears.find((fy) => fy.status === "ouvert")?.id ?? fiscalYears[0]?.id ?? null,
  );
  const fiscalYear = fiscalYears.find((fy) => fy.id === fiscalYearId) ?? null;
  const [lines, setLines] = React.useState<TrialBalanceLine[] | null>(null);
  const [totals, setTotals] = React.useState({ totalDebit: 0, totalCredit: 0 });
  const [partyType, setPartyType] = React.useState<ThirdPartyType>("renter");
  const [tiers, setTiers] = React.useState<ThirdPartyBalanceLine[] | null>(null);
  const [income, setIncome] = React.useState<IncomeStatement | null>(null);
  const [balanceSheet, setBalanceSheet] = React.useState<BalanceSheet | null>(null);
  const [cashFlow, setCashFlow] = React.useState<CashFlowStatement | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState<"pdf" | "xlsx" | null>(null);

  React.useEffect(() => {
    if (!accessToken || !fiscalYearId) return;
    getTrialBalance(accessToken, fiscalYearId)
      .then((res) => {
        setLines(res.lines);
        setTotals(res.totals);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la balance."));
  }, [accessToken, fiscalYearId]);

  React.useEffect(() => {
    if (!accessToken) return;
    getThirdPartyBalance(accessToken, partyType).then((res) => setTiers(res.thirdParties));
  }, [accessToken, partyType]);

  React.useEffect(() => {
    if (!accessToken || !fiscalYearId || !fiscalYear) return;
    Promise.all([
      getIncomeStatement(accessToken, fiscalYearId),
      getBalanceSheet(accessToken, fiscalYearId),
      getCashFlow(accessToken, fiscalYear.startDate, fiscalYear.endDate),
    ])
      .then(([i, b, c]) => {
        setIncome(i);
        setBalanceSheet(b);
        setCashFlow(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les états financiers."));
  }, [accessToken, fiscalYearId, fiscalYear]);

  async function handleExport(kind: "pdf" | "xlsx") {
    if (!accessToken || !fiscalYearId || !fiscalYear) return;
    setExporting(kind);
    setError(null);
    try {
      if (kind === "pdf") {
        await openAuthenticatedPdf(financialStatementsPdfPath(fiscalYearId), accessToken);
      } else {
        await downloadAuthenticatedFile(
          financialStatementsXlsxPath(fiscalYearId),
          accessToken,
          `etats-financiers-${fiscalYear.label}.xlsx`,
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export impossible.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-label-md uppercase tracking-wider text-ink-muted">États financiers SYSCOHADA</h2>
          <div className="flex items-center gap-2">
            <select
              value={fiscalYearId ?? ""}
              onChange={(e) => setFiscalYearId(Number(e.target.value))}
              className={`${SELECT_CLASS} max-w-xs`}
            >
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.id}>
                  {fy.label} {fy.status === "cloture" ? "(clôturé)" : ""}
                </option>
              ))}
            </select>
            <Button variant="secondary" size="sm" disabled={!fiscalYearId || exporting !== null} onClick={() => handleExport("pdf")}>
              <FileDown size={14} />
              PDF
            </Button>
            <Button variant="secondary" size="sm" disabled={!fiscalYearId || exporting !== null} onClick={() => handleExport("xlsx")}>
              <FileSpreadsheet size={14} />
              Excel
            </Button>
          </div>
        </div>
        <p className="text-body-xs text-ink-muted">
          Situation provisoire calculée depuis les écritures enregistrées — le résultat net est une ligne calculée, pas
          une écriture d&apos;affectation formelle. À faire valider par un expert-comptable avant toute utilisation
          officielle.
        </p>

        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {income && balanceSheet && cashFlow && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-headline-sm">Compte de résultat</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-body-sm">
                {income.produits.map((p) => (
                  <div key={p.code} className="flex justify-between">
                    <span className="text-ink-soft">{p.code} — {p.label}</span>
                    <span className="tabular">{formatFcfa(p.amount)}</span>
                  </div>
                ))}
                {income.charges.map((c) => (
                  <div key={c.code} className="flex justify-between">
                    <span className="text-ink-soft">{c.code} — {c.label}</span>
                    <span className="tabular">−{formatFcfa(c.amount)}</span>
                  </div>
                ))}
                <div className="mt-1 flex justify-between border-t border-border pt-1.5 font-semibold">
                  <span>Résultat net</span>
                  <span className={`tabular ${income.resultatNet >= 0 ? "text-success-fg" : "text-danger-fg"}`}>
                    {formatFcfa(income.resultatNet)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-headline-sm">Bilan</CardTitle>
                <CardDescription>
                  {balanceSheet.balanced ? "Actif = Passif" : "Anomalie : actif ≠ passif — contactez le support"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-body-sm">
                <p className="font-label-sm uppercase tracking-wider text-ink-muted">Actif</p>
                {balanceSheet.actif.map((a) => (
                  <div key={a.code} className="flex justify-between">
                    <span className="text-ink-soft">{a.code} — {a.label}</span>
                    <span className="tabular">{formatFcfa(a.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <span>Total actif</span>
                  <span className="tabular">{formatFcfa(balanceSheet.totalActif)}</span>
                </div>
                <p className="mt-2 font-label-sm uppercase tracking-wider text-ink-muted">Passif</p>
                {balanceSheet.passif.map((p) => (
                  <div key={p.code} className="flex justify-between">
                    <span className="text-ink-soft">{p.code} — {p.label}</span>
                    <span className="tabular">{formatFcfa(p.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <span>Total passif</span>
                  <span className="tabular">{formatFcfa(balanceSheet.totalPassif)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-headline-sm">Flux de trésorerie</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-body-sm">
                <div className="flex justify-between">
                  <span className="text-ink-soft">Début de période</span>
                  <span className="tabular">{formatFcfa(cashFlow.openingBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-soft">Encaissements</span>
                  <span className="tabular text-success-fg">+{formatFcfa(cashFlow.totalInflows)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-soft">Décaissements</span>
                  <span className="tabular text-danger-fg">−{formatFcfa(cashFlow.totalOutflows)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <span>Fin de période</span>
                  <span className="tabular">{formatFcfa(cashFlow.closingBalance)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-label-md uppercase tracking-wider text-ink-muted">Balance générale</h2>
        </div>
        {lines && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Compte</TableHead>
                <TableHead className="text-right">Débit</TableHead>
                <TableHead className="text-right">Crédit</TableHead>
                <TableHead className="text-right">Solde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.accountId}>
                  <TableCell>
                    {l.code} — {l.label}
                  </TableCell>
                  <TableAmount>{formatFcfa(l.totalDebit)}</TableAmount>
                  <TableAmount>{formatFcfa(l.totalCredit)}</TableAmount>
                  <TableAmount>{formatFcfa(l.balance)}</TableAmount>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell>Total</TableCell>
                <TableAmount>{formatFcfa(totals.totalDebit)}</TableAmount>
                <TableAmount>{formatFcfa(totals.totalCredit)}</TableAmount>
                <TableAmount>{formatFcfa(totals.totalDebit - totals.totalCredit)}</TableAmount>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-label-md uppercase tracking-wider text-ink-muted">Balance auxiliaire des tiers</h2>
          <select
            value={partyType}
            onChange={(e) => setPartyType(e.target.value as ThirdPartyType)}
            className={`${SELECT_CLASS} max-w-xs`}
          >
            {THIRD_PARTY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {tiers && tiers.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucun tiers pour ce type.</p>
        ) : (
          tiers && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Compte auxiliaire</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Nature</TableHead>
                  <TableHead className="text-right">Solde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tiers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="tabular">{t.auxiliaryCode}</TableCell>
                    <TableCell>{t.displayName}</TableCell>
                    <TableCell className="text-ink-soft">
                      {t.controlAccount.code} — {t.controlAccount.label}
                    </TableCell>
                    <TableAmount>{formatFcfa(t.balance)}</TableAmount>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        )}
      </div>
    </div>
  );
}

// ── Exercices ──────────────────────────────────────────────────────────────

function ExercicesTab({
  accessToken,
  fiscalYears,
  onChanged,
}: {
  accessToken: string | null;
  fiscalYears: GlFiscalYear[];
  onChanged: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [closingId, setClosingId] = React.useState<number | null>(null);
  const toast = useToast();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await createGlFiscalYear(accessToken, { label: label.trim(), startDate, endDate });
      toast.success("Exercice ouvert.");
      setOpen(false);
      setLabel("");
      setStartDate("");
      setEndDate("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ouvrir cet exercice.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClose(fy: GlFiscalYear) {
    if (!accessToken) return;
    const ok = window.confirm(
      `Clôturer définitivement l'exercice ${fy.label} ? Cette action est irréversible : plus aucune écriture ne pourra y être ajoutée.`,
    );
    if (!ok) return;
    setClosingId(fy.id);
    try {
      await closeGlFiscalYear(accessToken, fy.id);
      toast.success(`Exercice ${fy.label} clôturé.`);
      onChanged();
    } catch (err) {
      toast.info(err instanceof ApiError ? err.message : "Impossible de clôturer cet exercice.");
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Exercices comptables</span>
        <Button variant="info" size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} />
          {open ? "Fermer" : "Ouvrir un exercice"}
        </Button>
      </div>

      {open && (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Libellé" htmlFor="fyLabel" required hint="Ex. 2027">
              <Input id="fyLabel" value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Début" htmlFor="fyStart" required>
              <Input id="fyStart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Fin" htmlFor="fyEnd" required>
              <Input id="fyEnd" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={submitting || !label.trim() || !startDate || !endDate} className="self-start">
            {submitting ? "Ouverture…" : "Ouvrir l'exercice"}
          </Button>
        </form>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Libellé</TableHead>
            <TableHead>Période</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {fiscalYears.map((fy) => (
            <TableRow key={fy.id}>
              <TableCell>{fy.label}</TableCell>
              <TableCell>
                {formatDateLabel(fy.startDate)} → {formatDateLabel(fy.endDate)}
              </TableCell>
              <TableCell>
                <Badge variant={fy.status === "ouvert" ? "success" : "neutral"}>
                  {fy.status === "ouvert" ? "Ouvert" : "Clôturé"}
                </Badge>
              </TableCell>
              <TableCell>
                {fy.status === "ouvert" && (
                  <Button variant="danger" size="sm" disabled={closingId === fy.id} onClick={() => handleClose(fy)}>
                    <Lock size={14} />
                    {closingId === fy.id ? "Clôture…" : "Clôturer"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Rapprochement bancaire ─────────────────────────────────────────────────
// Compare le solde comptable du compte banque (521, seul compte banque de ce
// système) avec un relevé bancaire saisi manuellement (aucune intégration
// bancaire réelle). Maître-détail dans le même onglet : la liste des
// rapprochements passés, et le détail de celui sélectionné en dessous.

function RapprochementTab({ accessToken }: { accessToken: string | null }) {
  const [reconciliations, setReconciliations] = React.useState<BankReconciliation[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listBankReconciliations(accessToken)
      .then((res) => setReconciliations(res.reconciliations))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les rapprochements bancaires."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  if (selectedId !== null) {
    return (
      <RapprochementDetail
        accessToken={accessToken}
        reconciliationId={selectedId}
        onBack={() => setSelectedId(null)}
        onChanged={load}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-sm text-ink-soft">
        Compare le solde du compte banque (521) tel que calculé par la comptabilité avec le solde réel de votre
        relevé bancaire, mois par mois. Aucune connexion bancaire : le solde du relevé se saisit à la main.
      </p>
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}

      <NewReconciliationForm accessToken={accessToken} onCreated={(id) => { load(); setSelectedId(id); }} />

      {reconciliations === null ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : reconciliations.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Aucun rapprochement enregistré.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Période</TableHead>
              <TableHead className="text-right">Solde relevé</TableHead>
              <TableHead className="text-right">Solde comptable</TableHead>
              <TableHead className="text-right">Écart</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {reconciliations.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelectedId(r.id)}>
                <TableCell>{r.period}</TableCell>
                <TableAmount>{formatFcfa(r.statementBalance)}</TableAmount>
                <TableAmount>{formatFcfa(r.bookBalance)}</TableAmount>
                <TableCell className={`text-right tabular ${r.gap === 0 ? "text-success-fg" : "text-warning-fg"}`}>
                  {formatFcfa(r.gap)}
                </TableCell>
                <TableCell>
                  <Badge variant={r.status === "rapproche" ? "success" : "neutral"}>
                    {r.status === "rapproche" ? "Clôturé" : "En cours"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedId(r.id)}>
                    Ouvrir
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function NewReconciliationForm({ accessToken, onCreated }: { accessToken: string | null; onCreated: (id: number) => void }) {
  const [open, setOpen] = React.useState(false);
  const [period, setPeriod] = React.useState(() => new Date().toISOString().slice(0, 7));
  const [statementBalance, setStatementBalance] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await startBankReconciliation(accessToken, { period, statementBalance: Number(statementBalance) });
      setOpen(false);
      setStatementBalance("");
      toast.success(`Rapprochement de ${period} démarré.`);
      onCreated(res.reconciliationId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de démarrer ce rapprochement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Nouveau rapprochement</span>
        <Button variant="info" size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} />
          {open ? "Fermer" : "Démarrer un rapprochement"}
        </Button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mois du relevé" htmlFor="brPeriod" required>
              <input
                id="brPeriod"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className={SELECT_CLASS}
              />
            </Field>
            <Field label="Solde de fin de mois (relevé bancaire)" htmlFor="brBalance" required hint="Tel qu'indiqué sur votre relevé papier ou PDF">
              <Input
                id="brBalance"
                inputMode="numeric"
                value={statementBalance}
                onChange={(e) => setStatementBalance(e.target.value.replace(/[^\d-]/g, ""))}
              />
            </Field>
          </div>
          <Button type="submit" disabled={submitting || !period || statementBalance === ""} className="self-start">
            {submitting ? "Démarrage…" : "Démarrer le rapprochement"}
          </Button>
        </form>
      )}
    </div>
  );
}

function RapprochementDetail({
  accessToken,
  reconciliationId,
  onBack,
  onChanged,
}: {
  accessToken: string | null;
  reconciliationId: number;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = React.useState<BankReconciliationDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pointingId, setPointingId] = React.useState<number | null>(null);
  const [removingId, setRemovingId] = React.useState<number | null>(null);
  const [addingBankLine, setAddingBankLine] = React.useState(false);
  const [bankReference, setBankReference] = React.useState("");
  const [bankAmount, setBankAmount] = React.useState("");
  const [bankDate, setBankDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [finalizing, setFinalizing] = React.useState(false);
  const [confirmForce, setConfirmForce] = React.useState(false);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getBankReconciliation(accessToken, reconciliationId)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger ce rapprochement."));
  }, [accessToken, reconciliationId]);

  React.useEffect(() => load(), [load]);

  async function handlePoint(entryLineId: number) {
    if (!accessToken) return;
    setPointingId(entryLineId);
    setError(null);
    try {
      await pointBankMovement(accessToken, reconciliationId, entryLineId);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de pointer ce mouvement.");
    } finally {
      setPointingId(null);
    }
  }

  async function handleRemove(lineId: number) {
    if (!accessToken) return;
    setRemovingId(lineId);
    setError(null);
    try {
      await removeBankReconciliationLine(accessToken, reconciliationId, lineId);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de retirer cette ligne.");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleAddBankLine(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);
    try {
      await addBankOnlyLine(accessToken, reconciliationId, {
        bankReference: bankReference.trim() || undefined,
        bankAmount: Number(bankAmount),
        bankDate,
      });
      setAddingBankLine(false);
      setBankReference("");
      setBankAmount("");
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette ligne.");
    }
  }

  async function handleFinalize(force: boolean) {
    if (!accessToken) return;
    setFinalizing(true);
    setError(null);
    try {
      await finalizeBankReconciliation(accessToken, reconciliationId, force);
      setConfirmForce(false);
      toast.success("Rapprochement clôturé.");
      load();
      onChanged();
    } catch (err) {
      if (!force) {
        // Refusé sans confirmation (mouvements non pointés ou écart non nul) —
        // proposé ci-dessous comme un choix explicite, jamais bloqué en silence.
        setConfirmForce(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Impossible de clôturer ce rapprochement.");
      }
    } finally {
      setFinalizing(false);
    }
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
          <ArrowLeft size={14} /> Retour
        </Button>
        {error ? <p className="text-body-sm text-danger-fg">{error}</p> : <p className="text-body-sm text-ink-muted">Chargement…</p>}
      </div>
    );
  }

  const { reconciliation, lines, unmatchedBookMovements } = detail;
  const isOpen = reconciliation.status === "en_cours";
  const canFinalizeCleanly = unmatchedBookMovements.length === 0 && reconciliation.gap === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={14} /> Retour à la liste
        </Button>
        <Badge variant={reconciliation.status === "rapproche" ? "success" : "neutral"}>
          {reconciliation.status === "rapproche" ? "Clôturé" : "En cours"}
        </Badge>
      </div>

      {error && <p className="text-body-sm text-danger-fg">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={`Solde relevé — ${reconciliation.period}`} icon={<Landmark size={16} />} value={formatFcfa(reconciliation.statementBalance)} />
        <StatCard label="Solde comptable (compte 521)" icon={<Scale size={16} />} value={formatFcfa(reconciliation.bookBalance)} />
        <StatCard
          label="Écart"
          icon={reconciliation.gap === 0 ? <CircleCheck size={16} /> : <AlertTriangle size={16} />}
          value={formatFcfa(reconciliation.gap)}
          tone={reconciliation.gap === 0 ? "success" : "warning"}
        />
      </div>

      {isOpen && reconciliation.gap !== 0 && (
        <Field label="Corriger le solde du relevé" htmlFor="brEditBalance" hint="En cas d'erreur de saisie au démarrage">
          <EditStatementBalance
            accessToken={accessToken}
            reconciliationId={reconciliationId}
            current={reconciliation.statementBalance}
            onChanged={() => { load(); onChanged(); }}
          />
        </Field>
      )}

      <div>
        <p className="mb-2 font-label-sm uppercase tracking-wider text-ink-muted">
          Mouvements comptables pas encore pointés ({unmatchedBookMovements.length})
        </p>
        {unmatchedBookMovements.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Tous les mouvements de ce compte, jusqu&apos;à la fin du mois, sont pointés.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>N° pièce</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead className="text-right">Débit</TableHead>
                <TableHead className="text-right">Crédit</TableHead>
                {isOpen && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {unmatchedBookMovements.map((m) => (
                <TableRow key={m.entryLineId}>
                  <TableCell className="text-ink-soft">{m.entryDate}</TableCell>
                  <TableCell className="text-ink-soft">{m.entryNumber}</TableCell>
                  <TableCell>{m.narration}</TableCell>
                  <TableAmount>{m.side === "debit" ? formatFcfa(m.amount) : ""}</TableAmount>
                  <TableAmount>{m.side === "credit" ? formatFcfa(m.amount) : ""}</TableAmount>
                  {isOpen && (
                    <TableCell className="text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pointingId === m.entryLineId}
                        onClick={() => handlePoint(m.entryLineId)}
                      >
                        <CheckCircle2 size={14} />
                        {pointingId === m.entryLineId ? "Pointage…" : "Pointer"}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-label-sm uppercase tracking-wider text-ink-muted">Lignes du relevé bancaire ({lines.length})</p>
          {isOpen && (
            <Button variant="secondary" size="sm" onClick={() => setAddingBankLine((v) => !v)}>
              <Plus size={14} />
              {addingBankLine ? "Fermer" : "Ajouter une opération vue sur le relevé"}
            </Button>
          )}
        </div>

        {addingBankLine && (
          <form onSubmit={handleAddBankLine} className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
            <p className="text-body-xs text-ink-muted">
              Pour une opération que vous voyez sur le relevé mais qui n&apos;apparaît dans aucune de vos écritures
              (ex. frais bancaires, agios) — à enregistrer séparément comme dépense une fois repérée ici.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Référence (libellé banque)" htmlFor="brBankRef">
                <Input id="brBankRef" value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
              </Field>
              <Field label="Montant" htmlFor="brBankAmount" required>
                <Input
                  id="brBankAmount"
                  inputMode="numeric"
                  value={bankAmount}
                  onChange={(e) => setBankAmount(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label="Date" htmlFor="brBankDate" required>
                <Input id="brBankDate" type="date" value={bankDate} onChange={(e) => setBankDate(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" size="sm" disabled={!bankAmount || !bankDate} className="self-start">
              Enregistrer
            </Button>
          </form>
        )}

        {lines.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucune ligne saisie pour l&apos;instant.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Référence / libellé</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Origine</TableHead>
                {isOpen && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-ink-soft">{l.bankDate}</TableCell>
                  <TableCell>{l.entryLine ? l.entryLine.narration : l.bankReference || "—"}</TableCell>
                  <TableAmount>{formatFcfa(l.bankAmount)}</TableAmount>
                  <TableCell>
                    {l.entryLine ? (
                      <Badge variant="success">Pointé (écriture existante)</Badge>
                    ) : (
                      <Badge variant="warning">Vu sur le relevé seulement</Badge>
                    )}
                  </TableCell>
                  {isOpen && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" disabled={removingId === l.id} onClick={() => handleRemove(l.id)}>
                        <Undo2 size={14} />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {isOpen && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {confirmForce ? (
            <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-bg p-4">
              <p className="inline-flex items-center gap-2 text-body-sm text-warning-fg">
                <AlertTriangle size={16} />
                {unmatchedBookMovements.length > 0
                  ? `${unmatchedBookMovements.length} mouvement(s) ne sont pas encore pointés`
                  : "L'écart n'est pas nul"}
                {" "}— clôturer quand même ? Cette action est définitive.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="destructive" size="sm" disabled={finalizing} onClick={() => handleFinalize(true)}>
                  {finalizing ? "Clôture…" : "Oui, clôturer quand même"}
                </Button>
                <Button variant="ghost" size="sm" disabled={finalizing} onClick={() => setConfirmForce(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant={canFinalizeCleanly ? "primary" : "warning"}
              size="sm"
              className="self-start"
              disabled={finalizing}
              onClick={() => handleFinalize(false)}
            >
              <Lock size={14} />
              {finalizing ? "Clôture…" : "Clôturer le rapprochement"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function EditStatementBalance({
  accessToken,
  reconciliationId,
  current,
  onChanged,
}: {
  accessToken: string | null;
  reconciliationId: number;
  current: number;
  onChanged: () => void;
}) {
  const [value, setValue] = React.useState(String(current));
  const [submitting, setSubmitting] = React.useState(false);
  const toast = useToast();

  async function handleSave() {
    if (!accessToken) return;
    setSubmitting(true);
    try {
      await updateBankReconciliationStatement(accessToken, reconciliationId, Number(value));
      toast.success("Solde du relevé mis à jour.");
      onChanged();
    } catch (err) {
      toast.info(err instanceof ApiError ? err.message : "Impossible de mettre à jour ce solde.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d-]/g, ""))} className="max-w-[200px]" />
      <Button size="sm" variant="secondary" disabled={submitting || Number(value) === current} onClick={handleSave}>
        {submitting ? "…" : "Mettre à jour"}
      </Button>
    </div>
  );
}

// ── Règles comptables ──────────────────────────────────────────────────────

function ReglesTab({
  accessToken,
  accounts,
  onAccountsChanged,
}: {
  accessToken: string | null;
  accounts: GlAccount[];
  onAccountsChanged: () => void;
}) {
  const [rules, setRules] = React.useState<GlPostingRule[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [resyncing, setResyncing] = React.useState(false);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listGlPostingRules(accessToken)
      .then((res) => setRules(res.rules))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les règles comptables."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function toggleValidated(rule: GlPostingRule) {
    if (!accessToken) return;
    await updateGlPostingRule(accessToken, rule.id, { isValidatedByAccountant: !rule.isValidatedByAccountant });
    toast.success(
      rule.isValidatedByAccountant ? "Règle marquée comme non validée." : "Règle marquée comme validée par un comptable.",
    );
    load();
  }

  async function handleResync() {
    if (!accessToken) return;
    setResyncing(true);
    try {
      const res = await resyncGlPostingRules(accessToken);
      if (res.added.length === 0 && res.updatedSystemKeys.length === 0) {
        toast.info("Tout est déjà à jour (règles et comptes).");
      } else {
        const parts: string[] = [];
        if (res.added.length > 0) parts.push(`${res.added.length} règle(s) ajoutée(s) : ${res.added.join(", ")}`);
        if (res.updatedSystemKeys.length > 0) parts.push(`${res.updatedSystemKeys.length} compte(s) rattaché(s)`);
        toast.success(`${parts.join(" — ")}.`);
      }
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Resynchronisation impossible.");
    } finally {
      setResyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Ouvert au DG ET au comptable autorisé (`comptabilite_avancee`, déjà la
          condition d'accès à cet onglet) — décision explicite de l'utilisateur,
          contrairement à l'activation du module (ActivationCard, DG uniquement). */}
      <RenameableAccountsCard accessToken={accessToken} accounts={accounts} onChanged={onAccountsChanged} />
      <GlSettingsCard accessToken={accessToken} />

      <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-body-sm text-ink-soft">
          Chaque type d&apos;opération (loyer encaissé, dépense, salaire...) est associé à des comptes débit/crédit
          paramétrables. Les règles pré-chargées à la mise en place doivent être revues et validées par votre
          expert-comptable avant une utilisation en production.
        </p>
        <Button variant="secondary" size="sm" onClick={handleResync} disabled={resyncing} className="shrink-0">
          <RefreshCw size={14} />
          {resyncing ? "Resynchronisation…" : "Resynchroniser les règles"}
        </Button>
      </div>
      <p className="text-body-xs text-ink-muted">
        Ajoute les règles des opérations récemment introduites dans Lyko System et rattache les comptes qui en
        avaient besoin, sans jamais toucher une règle ou un compte déjà en place (validé ou non) — à utiliser si une
        opération signale l&apos;absence de règle ou de compte comptable.
      </p>
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      {!rules ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <details key={rule.id} className="rounded-lg border border-border bg-surface p-3">
              <summary className="flex cursor-pointer items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-label-md text-ink">{rule.label}</span>
                  <Badge variant="neutral">{rule.journal.code}</Badge>
                  {!rule.isActive && <Badge variant="danger">Inactive</Badge>}
                </div>
                <Badge variant={rule.isValidatedByAccountant ? "success" : "warning"}>
                  {rule.isValidatedByAccountant ? "Validée par un comptable" : "À valider"}
                </Badge>
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-body-xs text-ink-muted">Libellé généré : « {rule.narrationTemplate} »</p>
                <table className="w-full text-body-sm">
                  <tbody>
                    {rule.lines.map((l, i) => (
                      <tr key={i} className="border-t border-border first:border-0">
                        <td className="py-1.5 pr-3">
                          {l.accountCode ? `${l.accountCode} — ${l.accountLabel}` : `Résolu dynamiquement (${l.accountRole})`}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-muted">{l.side === "debit" ? "Débit" : "Crédit"}</td>
                        <td className="py-1.5 text-ink-muted">
                          {l.amountFormula === "montant_total" && "Montant total"}
                          {l.amountFormula === "pourcentage_variable" && `% (${l.formulaParam})`}
                          {l.amountFormula === "montant_moins_pourcentage" && `Montant − % (${l.formulaParam})`}
                          {l.amountFormula === "montant_fixe" && `Montant fixe : ${formatFcfa(l.fixedAmount ?? 0)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button variant="ghost" size="sm" className="self-start" onClick={() => toggleValidated(rule)}>
                  {rule.isValidatedByAccountant ? "Marquer comme non validée" : "Marquer comme validée par un comptable"}
                </Button>
              </div>
            </details>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

function RenameableAccountsCard({
  accessToken,
  accounts,
  onChanged,
}: {
  accessToken: string | null;
  accounts: GlAccount[];
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comptes personnalisables</CardTitle>
        <CardDescription>
          SYSCOHADA ne fixe pas de numéro officiel pour ces 2 comptes — la pratique varie selon les cabinets
          comptables. Une fois l&apos;avis de votre expert-comptable obtenu, vous pouvez choisir le numéro ici ;
          les écritures déjà enregistrées suivent automatiquement, rien n&apos;est perdu.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {RENAMEABLE_SYSTEM_ACCOUNTS.map((meta) => {
          const account = accounts.find((a) => a.systemKey === meta.key);
          return (
            <RenameableAccountRow
              key={meta.key}
              accessToken={accessToken}
              meta={meta}
              currentCode={account?.code ?? meta.defaultCode}
              onChanged={onChanged}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

function RenameableAccountRow({
  accessToken,
  meta,
  currentCode,
  onChanged,
}: {
  accessToken: string | null;
  meta: (typeof RENAMEABLE_SYSTEM_ACCOUNTS)[number];
  currentCode: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(currentCode);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (!editing) setValue(currentCode);
  }, [currentCode, editing]);

  async function handleSave() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await renameGlSystemAccount(accessToken, meta.key, value.trim());
      setEditing(false);
      toast.success(`Compte « ${meta.label} » renuméroté ${value.trim()}.`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de renommer ce compte.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-label-md text-ink">{meta.label}</p>
          <p className="text-body-xs text-ink-muted">{meta.hint}</p>
        </div>
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              className="w-28 tabular"
            />
            <Button size="sm" disabled={submitting || !value.trim()} onClick={handleSave}>
              {submitting ? "…" : "Enregistrer"}
            </Button>
            <Button size="sm" variant="ghost" disabled={submitting} onClick={() => { setEditing(false); setError(null); }}>
              Annuler
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="tabular font-label-md text-ink">{currentCode}</span>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Renuméroter
            </Button>
          </div>
        )}
      </div>
      {error && <p className="mt-1.5 text-body-xs text-danger-fg">{error}</p>}
    </div>
  );
}

// Autres hypothèses de jugement comptable restées configurables (voir les
// notes "À VALIDER" du seed) — pour l'instant, seul le prorata temporis de
// l'amortissement. D'autres réglages viendront s'ajouter ici (commission,
// répartition SONEB/SBEE...).
function GlSettingsCard({ accessToken }: { accessToken: string | null }) {
  const [settings, setSettings] = React.useState<GlSettings | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [percentInput, setPercentInput] = React.useState("");
  const [irfRateInput, setIrfRateInput] = React.useState("");
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getGlSettings(accessToken)
      .then((s) => {
        setSettings(s);
        setPercentInput(String(s.utilityPassThroughPercent));
        setIrfRateInput(String(s.irfRate));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les réglages."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function toggleProrata() {
    if (!accessToken || !settings) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await updateGlSettings(accessToken, { depreciationProrataTemporis: !settings.depreciationProrataTemporis });
      setSettings(next);
      toast.success(
        next.depreciationProrataTemporis
          ? "Amortissement proratisé au mois d'acquisition."
          : "Amortissement en mois plein, sans prorata.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de modifier ce réglage.");
    } finally {
      setSubmitting(false);
    }
  }

  async function savePercent() {
    if (!accessToken || !settings) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await updateGlSettings(accessToken, { utilityPassThroughPercent: Number(percentInput) });
      setSettings(next);
      setPercentInput(String(next.utilityPassThroughPercent));
      toast.success(`${next.utilityPassThroughPercent} % des charges SONEB/SBEE seront répercutées.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de modifier ce réglage.");
    } finally {
      setSubmitting(false);
    }
  }

  async function setCommissionTiming(timing: "encaissement" | "reversement") {
    if (!accessToken || !settings || settings.commissionTiming === timing) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await updateGlSettings(accessToken, { commissionTiming: timing });
      setSettings(next);
      toast.success(
        timing === "encaissement"
          ? "Commission comptabilisée dès l'encaissement du loyer."
          : "Commission comptabilisée au reversement au propriétaire.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de modifier ce réglage.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleIrf() {
    if (!accessToken || !settings) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await updateGlSettings(accessToken, { irfEnabled: !settings.irfEnabled });
      setSettings(next);
      toast.success(next.irfEnabled ? "Retenue IRF activée." : "Retenue IRF désactivée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de modifier ce réglage.");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveIrfRate() {
    if (!accessToken || !settings) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await updateGlSettings(accessToken, { irfRate: Number(irfRateInput) });
      setSettings(next);
      setIrfRateInput(String(next.irfRate));
      toast.success(`Taux IRF fixé à ${next.irfRate} %.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de modifier ce réglage.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!settings) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Réglages</CardTitle>
        <CardDescription>
          D&apos;autres choix que SYSCOHADA ne tranche pas — à ajuster une fois l&apos;avis de votre expert-comptable
          obtenu.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
          <input
            type="checkbox"
            checked={settings.depreciationProrataTemporis}
            disabled={submitting}
            onChange={toggleProrata}
            className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
          />
          <span>
            <span className="font-label-md text-ink">Proratiser le 1er mois d&apos;amortissement</span>
            <p className="text-body-xs text-ink-muted">
              Une immobilisation acquise en cours de mois n&apos;amortit que les jours restants de ce mois-là, au
              lieu d&apos;un mois plein. Les mois suivants restent pleins.
            </p>
          </span>
        </label>

        <div className="rounded-lg border border-border px-3 py-2.5">
          <p className="font-label-md text-ink">Charges SONEB/SBEE répercutées au locataire</p>
          <p className="text-body-xs text-ink-muted">
            Part de chaque charge encaissée qui éteint la dette du locataire (411) ; le reste est gardé par le
            cabinet comme frais de gestion (706). 100 % = tout répercuté, rien gardé (comportement historique).
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Input
              inputMode="numeric"
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value.replace(/\D/g, "").slice(0, 3))}
              className="w-20 tabular"
            />
            <span className="text-body-sm text-ink-soft">%</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={submitting || percentInput === "" || Number(percentInput) === settings.utilityPassThroughPercent}
              onClick={savePercent}
            >
              Enregistrer
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border px-3 py-2.5">
          <p className="font-label-md text-ink">Moment de comptabilisation de la commission</p>
          <p className="text-body-xs text-ink-muted">
            La commission du cabinet (706) peut être constatée dès l&apos;encaissement du loyer (comportement
            historique), ou seulement au moment où l&apos;argent est réellement reversé au propriétaire.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={settings.commissionTiming === "encaissement" ? "primary" : "secondary"}
              disabled={submitting}
              onClick={() => setCommissionTiming("encaissement")}
            >
              À l&apos;encaissement du loyer
            </Button>
            <Button
              type="button"
              size="sm"
              variant={settings.commissionTiming === "reversement" ? "primary" : "secondary"}
              disabled={submitting}
              onClick={() => setCommissionTiming("reversement")}
            >
              Au reversement au propriétaire
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border px-3 py-2.5">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={settings.irfEnabled}
              disabled={submitting}
              onChange={toggleIrf}
              className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
            />
            <span>
              <span className="font-label-md text-ink">Retenue IRF sur les reversements aux propriétaires</span>
              <p className="text-body-xs text-ink-muted">
                Impôt sur le Revenu Foncier retenu à la source à chaque reversement, en attente d&apos;être reversé
                au fisc (voir la carte « IRF à reverser » ci-dessous). Désactivé par défaut.
              </p>
            </span>
          </label>
          {settings.irfEnabled && (
            <div className="mt-2 flex items-center gap-2 pl-6">
              <Input
                inputMode="numeric"
                value={irfRateInput}
                onChange={(e) => setIrfRateInput(e.target.value.replace(/\D/g, "").slice(0, 3))}
                className="w-20 tabular"
              />
              <span className="text-body-sm text-ink-soft">%</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={submitting || irfRateInput === "" || Number(irfRateInput) === settings.irfRate}
                onClick={saveIrfRate}
              >
                Enregistrer
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// IRF déjà retenu (compte 442) mais pas encore reversé au fisc — même
// principe que le règlement d'une dépense à crédit (fournisseurs) : une
// dette déjà constatée, ce composant se contente de la solder, jamais de
// générer une nouvelle charge.
function IrfBalanceCard({ accessToken }: { accessToken: string | null }) {
  const [balance, setBalance] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [paying, setPaying] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("virement");
  const [paidAt, setPaidAt] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getIrfBalance(accessToken)
      .then((res) => setBalance(res.balanceOwed))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le solde IRF."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await payIrf(accessToken, { amount: Number(amount), paymentMethod: method, paidAt });
      setPaying(false);
      setAmount("");
      toast.success("IRF reversé au fisc.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce règlement.");
    } finally {
      setSubmitting(false);
    }
  }

  if (balance === null) return null;
  if (balance === 0 && !error) return null;

  return (
    <Card className="border-warning-border bg-warning/5">
      <CardHeader>
        <CardTitle>IRF à reverser au fisc</CardTitle>
        <CardDescription>Retenu sur les reversements aux propriétaires, pas encore reversé à l&apos;État.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <p className="tabular font-currency-table text-headline-sm text-warning-fg">{formatFcfa(balance)}</p>

        {paying ? (
          <form onSubmit={handlePay} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input
                inputMode="numeric"
                placeholder="Montant"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              />
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={SELECT_CLASS}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={submitting || !amount}>
                {submitting ? "Enregistrement…" : "Confirmer le règlement"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPaying(false)} disabled={submitting}>
                Annuler
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="warning" className="self-start" onClick={() => { setAmount(String(balance)); setPaying(true); }}>
            Reverser au fisc
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
