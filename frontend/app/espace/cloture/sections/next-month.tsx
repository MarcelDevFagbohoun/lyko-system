"use client";

import * as React from "react";
import { Lock, CheckCircle2 } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  getDashboard,
  closePeriod,
  type AccountingDashboard,
  type ClosingOverview,
} from "@/lib/api/accounting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/lib/toast/toast-context";
import {
  cn,
  formatDateLabel,
  formatFcfa,
  monthLabelFr,
} from "@/lib/utils";
import { CheckRow, MonthRecap } from "./closing-checks";
import { capitalize, monthRange } from "./shared";

export function NextMonthSection({
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

export function NextMonthCard({
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

