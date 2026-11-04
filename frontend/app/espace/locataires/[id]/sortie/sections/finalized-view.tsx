"use client";

import * as React from "react";
import { FileDown, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  reopenMoveOutReport,
  markMoveOutGlRegularized,
  recordTenantPayout,
  chargeRepairFee,
  archiveMoveOutReport,
  moveOutReportPdfPath,
  type Lease,
  type MoveOutReport,
  type InspectionZone,
  type AdditionalDeposit,
  type ManualPayoutMethod,
} from "@/lib/api/renters";
import { compareInspectionReports, type ItemComparison } from "@/lib/inspection-comparison";
import { CONDITION_LABELS } from "@/lib/constants/inspection";
import { formatFcfa } from "@/lib/utils";
import { InspectionReadOnly } from "@/components/inspections/inspection-readonly";
import { SignatureBlock } from "@/components/inspections/signature-block";
import { ExitStatementTable } from "@/components/inspections/exit-statement";
import { ReopenReportButton } from "@/components/inspections/reopen-button";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCan } from "@/lib/auth/use-can";
import { useToast } from "@/lib/toast/toast-context";
import { REFUND_PAYMENT_METHODS, ReviewHistoryList } from "./shared";

export function FinalizedView({
  leaseId,
  lease,
  report,
  accessToken,
  onReportChange,
}: {
  leaseId: number;
  lease: Lease;
  report: MoveOutReport;
  accessToken: string | null;
  onReportChange: (report: MoveOutReport) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [regularizing, setRegularizing] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);
  const canRegularize = useCan("comptabilite");

  async function handleReopen(reason: string) {
    if (!accessToken) return;
    const res = await reopenMoveOutReport(accessToken, leaseId, reason);
    onReportChange(res.report);
  }

  async function handleMarkRegularized() {
    if (!accessToken) return;
    setRegularizing(true);
    try {
      const res = await markMoveOutGlRegularized(accessToken, leaseId);
      onReportChange(res.report);
    } finally {
      setRegularizing(false);
    }
  }

  // Décaissement/encaissement manuel et frais de service de réparation (migration 139, demande
  // utilisateur 2026-11-03) — DG ou comptable (`canRegularize`, même permission que la régularisation
  // comptable ci-dessus, cohérent avec le serveur : `requirePermission('comptabilite')`).
  async function handlePayout(method: ManualPayoutMethod, note: string) {
    if (!accessToken) return;
    const res = await recordTenantPayout(accessToken, leaseId, { method, note: note.trim() || undefined });
    onReportChange(res.report);
    toast.success(
      report.payoutDirection === "refund_to_tenant" ? "Caution restituée au locataire." : "Complément encaissé auprès du locataire.",
    );
  }

  async function handleRepairFee(amount: number, note: string) {
    if (!accessToken) return;
    const res = await chargeRepairFee(accessToken, leaseId, { amount, note: note.trim() || undefined });
    onReportChange(res.report);
    toast.success("Frais de service prélevés sur le solde propriétaire.");
  }

  // Archivage manuel (migration 140, demande utilisateur 2026-11-03) : DG ou comptable, uniquement
  // une fois le décaissement réglé — envoie le locataire dans l'onglet Archives (voir
  // services/renters.js) et le retire de la boîte « État des lieux ».
  async function handleArchive() {
    if (!accessToken) return;
    setArchiving(true);
    try {
      const res = await archiveMoveOutReport(accessToken, leaseId);
      onReportChange(res.report);
      toast.success("Locataire archivé.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible d'archiver pour l'instant.");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Décompte de sortie</CardTitle>
        <CardDescription>
          {lease.unit.designationLabel} ({lease.unit.code}) · sortie constatée le {report.conductedAt}
          {report.conductedBy && ` par ${report.conductedBy.name} (${report.conductedBy.roleLabel})`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <DownloadPvButton leaseId={lease.id} />
          {user?.role === "dg" && <ReopenReportButton onReopen={handleReopen} />}
        </div>

        {lease.moveInReport && <ComparisonSection moveIn={lease.moveInReport} moveOut={report} />}

        <InspectionReadOnly zones={report.zones} showDeductions accessToken={accessToken} />

        <BillingReportSection zones={report.zones} />

        <ExitStatementTable data={finalStatementData(report)} />
        {report.balanceDueAmount > 0 && (
          <p className="text-body-sm font-label-md text-danger-fg">
            {report.balanceResolution === "paid"
              ? `Le locataire a réglé la différence de ${formatFcfa(report.balanceDueAmount)}.`
              : report.balanceResolution === "repairs_by_tenant"
                ? `Le locataire effectue lui-même les réparations (équivalent de ${formatFcfa(report.balanceDueAmount)}).`
                : `Le locataire doit encore ${formatFcfa(report.balanceDueAmount)}.`}
            {report.balanceNote ? ` ${report.balanceNote}` : ""}
          </p>
        )}

        {lease.additionalDeposits.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Cautions supplémentaires</span>
            {lease.additionalDeposits.map((d) => (
              <AdditionalDepositSummaryRow key={d.type} deposit={d} />
            ))}
          </div>
        )}

        {report.generalNotes && (
          <div className="rounded-lg border border-border bg-surface-muted p-3">
            <p className="font-label-sm text-ink-muted">Notes générales</p>
            <p className="text-body-sm text-ink">{report.generalNotes}</p>
          </div>
        )}

        {report.tenantReserves && (
          <div className="rounded-lg border border-warning-border bg-warning-bg p-3">
            <p className="font-label-sm text-warning-fg">Réserves du locataire</p>
            <p className="text-body-sm text-ink">{report.tenantReserves}</p>
          </div>
        )}

        {report.totalDeductions > 0 && (
          <div
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between",
              report.glRegularizedAt ? "border-success-border bg-success-bg" : "border-warning-border bg-warning-bg",
            )}
          >
            {report.glRegularizedAt ? (
              <p className="text-body-sm text-success-fg">
                Retenue régularisée en comptabilité le {new Date(report.glRegularizedAt).toLocaleDateString("fr-FR")}
                {report.glRegularizedBy && ` par ${report.glRegularizedBy.name} (${report.glRegularizedBy.roleLabel})`}.
              </p>
            ) : (
              <>
                <p className="text-body-sm text-warning-fg">
                  Caution avec retenue : à régulariser manuellement dans Comptabilité avancée → Journal → Écriture
                  diverse (le sort comptable d&apos;une retenue n&apos;est pas encore automatisé).
                </p>
                {canRegularize && (
                  <Button type="button" variant="warning" size="sm" onClick={handleMarkRegularized} disabled={regularizing}>
                    {regularizing ? "…" : "Marquer réglé"}
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {report.payoutStatus === "pending" && report.payoutDirection && (
          canRegularize ? (
            <PayoutSection direction={report.payoutDirection} amount={report.payoutAmount ?? 0} onPay={handlePayout} />
          ) : (
            <p className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-body-sm text-warning-fg">
              {report.payoutDirection === "refund_to_tenant" ? "Caution" : "Complément"} en attente —{" "}
              {formatFcfa(report.payoutAmount ?? 0)} à {report.payoutDirection === "refund_to_tenant" ? "restituer au locataire" : "encaisser du locataire"}.
            </p>
          )
        )}

        {report.payoutStatus === "paid" && (
          <div className="flex flex-col gap-2 rounded-lg border border-success-border bg-success-bg p-3">
            <p className="text-body-sm text-success-fg">
              {report.payoutDirection === "refund_to_tenant" ? "Caution restituée" : "Complément encaissé"}
              {report.payoutAmount ? ` : ${formatFcfa(report.payoutAmount)}` : ""}
              {report.payoutMethod ? ` (${REFUND_PAYMENT_METHODS.find((m) => m.value === report.payoutMethod)?.label ?? report.payoutMethod})` : ""}
              {report.payoutPaidAt && ` le ${new Date(report.payoutPaidAt).toLocaleDateString("fr-FR")}`}
              {report.payoutPaidBy && ` par ${report.payoutPaidBy.name} (${report.payoutPaidBy.roleLabel})`}.
            </p>
            {report.repairFeeChargedAt ? (
              <p className="text-body-sm text-ink">
                Frais de service prélevés : {formatFcfa(report.repairFeeAmount ?? 0)} le{" "}
                {new Date(report.repairFeeChargedAt).toLocaleDateString("fr-FR")}
                {report.repairFeeChargedBy && ` par ${report.repairFeeChargedBy.name} (${report.repairFeeChargedBy.roleLabel})`}
                {report.repairFeeNote ? ` — ${report.repairFeeNote}` : ""}.
              </p>
            ) : (
              canRegularize && <RepairFeeSection onCharge={handleRepairFee} />
            )}
          </div>
        )}

        {report.payoutStatus !== "pending" &&
          (report.leaseArchivedAt ? (
            <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-body-xs text-ink-muted">
              Locataire archivé le {new Date(report.leaseArchivedAt).toLocaleDateString("fr-FR")}
              {report.leaseArchivedBy && ` par ${report.leaseArchivedBy.name} (${report.leaseArchivedBy.roleLabel})`}.
            </p>
          ) : (
            canRegularize && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <p className="text-body-sm text-ink-soft">
                  Décaissement réglé — vous pouvez archiver ce locataire, ce qui l&apos;envoie dans l&apos;onglet Archives.
                </p>
                <Button type="button" size="sm" onClick={handleArchive} disabled={archiving}>
                  {archiving ? "Archivage…" : "Archivé"}
                </Button>
              </div>
            )
          ))}

        {report.reviewHistory.length > 0 && <ReviewHistoryList history={report.reviewHistory} />}

        {report.reopenedAt && (
          <div className="rounded-lg border border-border bg-surface-muted p-3">
            <p className="text-body-xs text-ink-muted">
              Corrigée le {new Date(report.reopenedAt).toLocaleDateString("fr-FR")}
              {report.reopenedBy && ` par ${report.reopenedBy.name} (${report.reopenedBy.roleLabel})`}
              {report.reopenReason && ` — motif : ${report.reopenReason}`}.
            </p>
            {report.correctionChanges && report.correctionChanges.length > 0 ? (
              <ul className="mt-1 list-disc pl-5 text-body-xs text-ink-muted">
                {report.correctionChanges.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            ) : report.correctionChanges ? (
              <p className="mt-1 text-body-xs text-ink-muted">Aucun changement de contenu détecté par rapport à la version précédente.</p>
            ) : null}
          </div>
        )}

        {report.tenantSignatureUrl || report.agentSignatureUrl ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SignatureBlock label="Signature du locataire" url={report.tenantSignatureUrl} accessToken={accessToken} />
            <SignatureBlock label="Signature de l'agent" url={report.agentSignatureUrl} accessToken={accessToken} />
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-body-sm text-ink-muted">
            Imprimez le PV : le locataire et l&apos;entreprise le datent et le signent à la main dans les cadres prévus.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Comparaison automatique entrée/sortie (étape 13, idée n°9) — met en
 * évidence les dégradations pour justifier une éventuelle retenue sur la
 * caution. Se recalcule en direct pendant la saisie du brouillon de sortie
 * (mêmes props que sur la fiche finalisée).
 */
export function ComparisonSection({ moveIn, moveOut }: { moveIn: NonNullable<Lease["moveInReport"]>; moveOut: MoveOutReport }) {
  const results = React.useMemo(() => compareInspectionReports(moveIn, moveOut), [moveIn, moveOut]);
  const degraded = results.filter((r) => r.status === "degraded");
  const others = results.filter((r) => r.status !== "degraded");
  const [showOthers, setShowOthers] = React.useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="font-label-lg text-ink">Comparaison avec l&apos;état des lieux d&apos;entrée</h3>

      {degraded.length === 0 ? (
        <p className="text-body-sm text-success-fg">Aucune dégradation détectée par rapport à l&apos;entrée.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-body-sm text-danger-fg">
            {degraded.length} élément{degraded.length > 1 ? "s" : ""} dégradé{degraded.length > 1 ? "s" : ""} depuis l&apos;entrée :
          </p>
          {degraded.map((d) => <ComparisonRow key={`${d.zoneKey}-${d.itemKey}`} item={d} />)}
        </div>
      )}

      {others.length > 0 && (
        <button
          type="button"
          onClick={() => setShowOthers((v) => !v)}
          className="inline-flex w-fit items-center gap-1 text-body-xs text-ink-muted hover:text-ink"
        >
          {showOthers ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showOthers ? "Masquer" : "Voir"} les {others.length} autre{others.length > 1 ? "s" : ""} élément{others.length > 1 ? "s" : ""} comparé{others.length > 1 ? "s" : ""}
        </button>
      )}
      {showOthers && (
        <div className="flex flex-col gap-2">
          {others.map((d) => <ComparisonRow key={`${d.zoneKey}-${d.itemKey}`} item={d} />)}
        </div>
      )}
    </div>
  );
}

/**
 * Rapport de facturation : liste, en un seul endroit, tous les éléments
 * pour lesquels une décision "à facturer" a été prise (au moins une ligne
 * du catalogue ou personnalisée), avec le détail et le total — demande
 * explicite de l'utilisateur ("un rapport des choses à facturer et le
 * total"). Purement dérivé de `zones` : aucun appel réseau, aucune donnée
 * qui ne soit pas déjà dans le brouillon/la fiche finalisée.
 */
export function BillingReportSection({ zones }: { zones: InspectionZone[] }) {
  const billedItems = zones.flatMap((zone) =>
    zone.items
      .filter((item) => item.billing && item.billing.lines.length > 0)
      .map((item) => ({ zoneLabel: zone.label, item })),
  );
  if (billedItems.length === 0) return null;
  const total = billedItems.reduce((sum, { item }) => sum + item.deduction, 0);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-danger-border bg-danger-bg p-4">
      <h3 className="font-label-lg text-ink">Rapport de facturation</h3>
      <div className="flex flex-col gap-2">
        {billedItems.map(({ zoneLabel, item }) => (
          <div key={item.key} className="rounded-lg border border-border bg-surface px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-label-sm text-ink">
                {zoneLabel} — {item.label}
              </span>
              <span className="tabular font-label-sm text-danger-fg">{formatFcfa(item.deduction)}</span>
            </div>
            <ul className="mt-1 text-body-xs text-ink-muted">
              {item.billing!.lines.map((l, idx) => (
                <li key={idx}>
                  • {l.label}
                  {l.quantity > 1 ? ` × ${l.quantity}` : ""} — {formatFcfa(l.unitPrice * l.quantity)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-danger-border pt-2">
        <span className="font-label-md text-ink">Total facturé (éléments dégradés)</span>
        <span className="tabular font-currency-table text-headline-sm text-danger-fg">{formatFcfa(total)}</span>
      </div>
    </div>
  );
}

export const COMPARISON_STATUS_LABEL: Record<ItemComparison["status"], string> = {
  degraded: "Dégradé",
  improved: "Amélioré",
  same: "Inchangé",
  unrated: "Non comparable",
  added: "Ajouté à la sortie",
  removed: "Absent à la sortie",
};

export function ComparisonRow({ item }: { item: ItemComparison }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-body-sm",
        item.status === "degraded" ? "border-danger-border bg-danger-bg" : "border-border",
      )}
    >
      <span className="text-ink">
        {item.zoneLabel} — {item.itemLabel}
      </span>
      <div className="flex items-center gap-2 text-body-xs">
        <span className="text-ink-muted">{item.moveInCondition ? CONDITION_LABELS[item.moveInCondition] : "—"}</span>
        <span className="text-ink-faint">→</span>
        <span className={item.status === "degraded" ? "font-label-sm text-danger-fg" : "text-ink-muted"}>
          {item.moveOutCondition ? CONDITION_LABELS[item.moveOutCondition] : "—"}
        </span>
        <Badge variant={item.status === "degraded" ? "danger" : "neutral"}>{COMPARISON_STATUS_LABEL[item.status]}</Badge>
      </div>
    </div>
  );
}

export function DownloadPvButton({ leaseId }: { leaseId: number }) {
  const { accessToken } = useAuth();
  return (
    <Button
      variant="secondary"
      size="sm"
      className="self-start"
      onClick={() => accessToken && openAuthenticatedPdf(moveOutReportPdfPath(leaseId), accessToken)}
    >
      <FileDown size={16} />
      Télécharger le PV de sortie
    </Button>
  );
}

/** « Payer le locataire » / « Encaisser le complément » — décaissement manuel (migration 139). */
function PayoutSection({
  direction,
  amount,
  onPay,
}: {
  direction: "refund_to_tenant" | "collect_from_tenant";
  amount: number;
  onPay: (method: ManualPayoutMethod, note: string) => Promise<void>;
}) {
  const [method, setMethod] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick() {
    if (!method) {
      setError("Choisissez un mode de règlement.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onPay(method as ManualPayoutMethod, note);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce décaissement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-bg p-4">
      <div>
        <h3 className="font-label-lg text-ink">
          {direction === "refund_to_tenant" ? "Payer le locataire" : "Encaisser le complément"}
        </h3>
        <p className="text-body-sm text-ink-muted">
          {direction === "refund_to_tenant"
            ? `${formatFcfa(amount)} à restituer au locataire.`
            : `${formatFcfa(amount)} restant dû par le locataire, au-delà de sa caution.`}
        </p>
      </div>
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Mode de règlement" htmlFor="payoutMethod" required>
          <select
            id="payoutMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="" disabled>
              Choisir…
            </option>
            {REFUND_PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note (optionnel)" htmlFor="payoutNote">
          <Input id="payoutNote" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Button type="button" variant="warning" onClick={handleClick} disabled={submitting} className="self-start">
        {submitting ? "Enregistrement…" : direction === "refund_to_tenant" ? "Confirmer le paiement au locataire" : "Confirmer l'encaissement"}
      </Button>
    </div>
  );
}

/** Frais de service de l'agence pour la gestion d'une réparation (migration 139) — montant libre. */
function RepairFeeSection({ onCharge }: { onCharge: (amount: number, note: string) => Promise<void> }) {
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Montant invalide.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onCharge(value, note);
      setAmount("");
      setNote("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de prélever ces frais.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-success-border pt-2">
      <p className="text-body-sm text-ink">Prélever des frais de service pour la gestion d&apos;une réparation (sur le solde propriétaire) :</p>
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Montant (FCFA)" htmlFor="repairFeeAmount">
          <Input
            id="repairFeeAmount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            className="max-w-[160px]"
          />
        </Field>
        <Field label="Note (optionnel)" htmlFor="repairFeeNote">
          <Input id="repairFeeNote" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="button" variant="secondary" size="sm" onClick={handleClick} disabled={submitting}>
          {submitting ? "…" : "Prélever les frais"}
        </Button>
      </div>
    </div>
  );
}

export function AdditionalDepositSummaryRow({ deposit }: { deposit: AdditionalDeposit }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border-subtle px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-sm text-ink">{deposit.typeLabel}</span>
        <span className="tabular text-body-sm text-ink">{formatFcfa(deposit.amount)}</span>
      </div>
      <span className="text-body-xs text-ink-muted">
        {deposit.deductionAmount > 0 ? `${formatFcfa(deposit.deductionAmount)} retenu${deposit.deductionNote ? ` (${deposit.deductionNote})` : ""} · ` : "Aucune retenue · "}
        {deposit.returnedAmount ? `${formatFcfa(deposit.returnedAmount)} restitué` : "Rien à restituer"}
      </span>
    </div>
  );
}

/** Données du tableau « point de sortie » d'une fiche finalisée (montants figés à la finalisation). */
export function finalStatementData(report: MoveOutReport) {
  const itemsDeductions = report.zones.reduce((sum, z) => sum + z.items.reduce((t, it) => t + it.deduction, 0), 0);
  const rentOwed = report.rentOwedAmount || report.rentArrearsAmount;
  const billable = report.extraLines.filter((l) => l.kind !== "realisee_locataire").reduce((sum, l) => sum + l.amount, 0);
  const legacy = report.extraLines.length === 0 ? report.otherDeductionsAmount : 0;
  const peintureOverflow = Math.max(0, report.totalDeductions - itemsDeductions - report.otherDeductionsAmount - report.rentArrearsAmount);
  void billable;
  return {
    depositAmount: report.depositAmount,
    itemsDeductions,
    extraLines: legacy > 0 ? [{ kind: "autre" as const, label: report.otherDeductionsNote ?? "Autres retenues", amount: legacy }] : report.extraLines,
    rentOwed,
    rentMonths: [] as string[],
    peintureOverflow,
    refundMethodLabel: report.refundPaymentMethod ? REFUND_PAYMENT_METHODS.find((m) => m.value === report.refundPaymentMethod)?.label ?? null : null,
  };
}

