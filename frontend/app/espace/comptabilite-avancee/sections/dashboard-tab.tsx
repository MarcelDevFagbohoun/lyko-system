"use client";

import * as React from "react";
import {
  Wallet,
  Landmark,
  Smartphone,
  Scale,
  Bell,
  CheckCircle2,
  CircleCheck,
  AlertTriangle,
} from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  getTrialBalance,
  listGlNotifications,
  markGlNotificationRead,
  markAllGlNotificationsRead,
  getMandantsCabinetIndicator,
  type MandantsCabinetIndicator,
  type GlFiscalYear,
  type TrialBalanceLine,
  type GlNotification,
} from "@/lib/api/gl";
import { formatFcfa, formatDateLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateLiabilities } from "@/components/comptabilite/state-liabilities";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/lib/toast/toast-context";
import { IrfBalanceCard } from "./regles-tab";

export function DashboardTab({
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
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger l'indicateur mandants/entreprise."));
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
      <StateLiabilities accessToken={accessToken} />

      {isDg && <NotificationsPanel accessToken={accessToken} />}
    </div>
  );
}

// Séparation des fonds mandants/cabinet : la trésorerie réelle doit
// toujours couvrir ce qui est détenu pour le compte de tiers (propriétaires
// en attente de reversement + cautions locataires non restituées) — sinon
// le cabinet a puisé dans de l'argent qui ne lui appartient pas.
export function MandantsCabinetCard({ indicator }: { indicator: MandantsCabinetIndicator }) {
  const isCovered = indicator.coverage >= 0;
  return (
    <Card className={isCovered ? "border-success-border bg-success/5" : "border-danger-border bg-danger/5"}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-white ${isCovered ? "bg-success" : "bg-danger"}`}>
            {isCovered ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}
          </span>
          <CardTitle>Séparation des fonds — mandants / entreprise</CardTitle>
        </div>
        <CardDescription>
          Vérifie que la trésorerie réelle de l&apos;entreprise couvre bien ce qu&apos;elle détient pour le compte de tiers :
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

export const NOTIF_LABELS: Record<string, string> = {
  entry_reversed: "Écriture extournée",
  manual_entry: "Écriture manuelle",
  fiscal_year_closed: "Exercice clôturé",
  expense_threshold: "Dépense au-dessus du seuil",
  monthly_rent_digest: "Résumé mensuel des loyers",
  daily_arrears_digest: "Relances du jour",
  balance_imbalance_alert: "Alerte de balance",
  closing_reminder: "Rappel de clôture",
};

export function NotificationsPanel({ accessToken }: { accessToken: string | null }) {
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

