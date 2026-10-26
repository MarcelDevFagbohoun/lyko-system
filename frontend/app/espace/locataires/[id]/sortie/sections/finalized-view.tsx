"use client";

import * as React from "react";
import { FileDown, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { openAuthenticatedPdf } from "@/lib/api/client";
import {
  reopenMoveOutReport,
  markMoveOutGlRegularized,
  moveOutReportPdfPath,
  type Lease,
  type MoveOutReport,
  type InspectionZone,
  type AdditionalDeposit,
} from "@/lib/api/renters";
import { compareInspectionReports, type ItemComparison } from "@/lib/inspection-comparison";
import { CONDITION_LABELS } from "@/lib/constants/inspection";
import { formatFcfa } from "@/lib/utils";
import { InspectionReadOnly } from "@/components/inspections/inspection-readonly";
import { SignatureBlock } from "@/components/inspections/signature-block";
import { ExitStatementTable } from "@/components/inspections/exit-statement";
import { ReopenReportButton } from "@/components/inspections/reopen-button";
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
import { REFUND_PAYMENT_METHODS } from "./shared";

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
  const [regularizing, setRegularizing] = React.useState(false);
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

