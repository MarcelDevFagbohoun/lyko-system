"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, FileDown, AlertTriangle, ClipboardList, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  getRenter,
  startMoveOutReport,
  updateMoveOutReport,
  uploadInspectionItemPhoto,
  deleteInspectionItemPhoto,
  finalizeMoveOutReport,
  moveOutReportPdfPath,
  type Lease,
  type MoveOutReport,
  type InspectionZone,
} from "@/lib/api/renters";
import { compareInspectionReports, type ItemComparison } from "@/lib/inspection-comparison";
import { CONDITION_LABELS } from "@/lib/constants/inspection";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { InspectionForm } from "@/components/inspections/inspection-form";
import { InspectionReadOnly } from "@/components/inspections/inspection-readonly";
import { FinalizeSection } from "@/components/inspections/finalize-section";
import { SignatureBlock } from "@/components/inspections/signature-block";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/lib/toast/toast-context";

export function SortieView() {
  return (
    <RequireAuth permission="etats_des_lieux">
      <SortieContent />
    </RequireAuth>
  );
}

function SortieContent() {
  const { id } = useParams<{ id: string }>();
  const renterId = Number(id);
  const searchParams = useSearchParams();
  const leaseId = Number(searchParams.get("leaseId"));
  const router = useRouter();
  const { accessToken } = useAuth();

  const [lease, setLease] = React.useState<Lease | null>(null);
  const [renterName, setRenterName] = React.useState("");
  const [report, setReport] = React.useState<MoveOutReport | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken || !Number.isInteger(renterId) || !Number.isInteger(leaseId)) return;
    getRenter(accessToken, renterId)
      .then((res) => {
        setRenterName(`${res.renter.firstName} ${res.renter.lastName}`);
        const found = res.leases.find((l) => l.id === leaseId);
        if (!found) throw new ApiError(404, "Bail introuvable");
        setLease(found);
        setReport(found.moveOutReport);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Impossible de charger le bail."));
  }, [accessToken, renterId, leaseId]);

  React.useEffect(() => load(), [load]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10">
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (!lease) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link
          href={`/espace/locataires/${renterId}`}
          className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={16} />
          Retour à la fiche de {renterName}
        </Link>

        {report?.status === "finalized" ? (
          <FinalizedView lease={lease} report={report} />
        ) : report ? (
          <DraftEditor
            leaseId={leaseId}
            lease={lease}
            report={report}
            accessToken={accessToken}
            onReportChange={setReport}
            onFinalized={() => router.push(`/espace/locataires/${renterId}`)}
          />
        ) : lease.status !== "active" ? (
          <Card className="max-w-2xl">
            <CardContent className="py-6 text-body-sm text-ink-muted">
              Ce bail est déjà terminé sans état des lieux de sortie enregistré (départ traité avant la mise en
              place de ce module). Aucun décompte de caution ne peut être généré rétroactivement.
            </CardContent>
          </Card>
        ) : (
          <StartCard leaseId={leaseId} accessToken={accessToken} onStarted={setReport} />
        )}
      </div>
    </div>
  );
}

function StartCard({
  leaseId,
  accessToken,
  onStarted,
}: {
  leaseId: number;
  accessToken: string | null;
  onStarted: (report: MoveOutReport) => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleStart() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await startMoveOutReport(accessToken, leaseId);
      onStarted(res.report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de démarrer la sortie.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <ClipboardList size={28} className="text-ink-muted" />
        <p className="font-label-md text-ink">Organiser la sortie de ce locataire</p>
        <p className="text-body-sm text-ink-muted">
          La fiche reprend les zones/éléments de l&apos;état des lieux d&apos;entrée (si elle existe), pour comparer
          facilement les deux.
        </p>
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <Button onClick={handleStart} disabled={submitting}>
          {submitting ? "Démarrage…" : "Commencer l'état des lieux de sortie"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DraftEditor({
  leaseId,
  lease,
  report,
  accessToken,
  onReportChange,
  onFinalized,
}: {
  leaseId: number;
  lease: Lease;
  report: MoveOutReport;
  accessToken: string | null;
  onReportChange: (report: MoveOutReport) => void;
  onFinalized: () => void;
}) {
  const [zones, setZones] = React.useState<InspectionZone[]>(report.zones);
  const [generalNotes, setGeneralNotes] = React.useState(report.generalNotes ?? "");
  const [otherAmount, setOtherAmount] = React.useState(report.otherDeductionsAmount ? String(report.otherDeductionsAmount) : "");
  const [otherNote, setOtherNote] = React.useState(report.otherDeductionsNote ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [finalizing, setFinalizing] = React.useState(false);
  const [finalizeError, setFinalizeError] = React.useState<string | null>(null);
  const toast = useToast();

  const itemsTotal = zones.reduce((sum, z) => sum + z.items.reduce((s, it) => s + it.deduction, 0), 0);
  const otherTotal = Number(otherAmount) || 0;
  const totalDeductions = itemsTotal + otherTotal;
  const netRefund = Math.max(0, report.depositAmount - totalDeductions);

  async function persist() {
    if (!accessToken) throw new Error("no token");
    const res = await updateMoveOutReport(accessToken, leaseId, {
      zones,
      generalNotes: generalNotes.trim() || undefined,
      otherDeductionsAmount: otherTotal || undefined,
      otherDeductionsNote: otherNote.trim() || undefined,
    });
    onReportChange(res.report);
    setZones(res.report.zones);
    return res.report;
  }

  async function handleSave() {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      await persist();
      toast.success("Brouillon enregistré.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer le brouillon.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadPhoto(zoneKey: string, itemKey: string, file: File) {
    if (!accessToken) return;
    try {
      const res = await uploadInspectionItemPhoto(accessToken, "move-out", leaseId, zoneKey, itemKey, file);
      onReportChange(res.report as MoveOutReport);
      setZones(res.report.zones);
      toast.success("Photo envoyée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer la photo.");
    }
  }

  async function handleDeletePhoto(zoneKey: string, itemKey: string) {
    if (!accessToken) return;
    try {
      const res = await deleteInspectionItemPhoto(accessToken, "move-out", leaseId, zoneKey, itemKey);
      onReportChange(res.report as MoveOutReport);
      setZones(res.report.zones);
      toast.info("Photo retirée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de retirer la photo.");
    }
  }

  async function handleFinalize(tenantSignature: Blob, agentSignature: Blob) {
    if (!accessToken) return;
    setFinalizing(true);
    setFinalizeError(null);
    try {
      // Comme pour l'entrée : on sauvegarde le brouillon avant de finaliser,
      // pour ne jamais figer une version en retard sur l'écran affiché.
      await persist();
      const res = await finalizeMoveOutReport(accessToken, leaseId, tenantSignature, agentSignature);
      onReportChange(res.report);
      toast.success("Sortie finalisée — bail terminé, unité libérée.");
      onFinalized();
    } catch (err) {
      setFinalizeError(err instanceof ApiError ? err.message : "Impossible de finaliser la sortie.");
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Organiser la sortie — brouillon</CardTitle>
        <CardDescription>
          {lease.unit.designationLabel} ({lease.unit.code}) · état des lieux contradictoire et décompte de caution.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {lease.arrears?.status === "late" && (
          <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2.5 text-body-sm text-warning-fg">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Loyer en retard de {lease.arrears.daysLate} jour(s) (échéance du {lease.arrears.dueDate}). Vous
              pouvez en tenir compte via « Autres retenues » ci-dessous si vous souhaitez le déduire de la caution.
            </span>
          </div>
        )}

        {lease.moveInReport && <ComparisonSection moveIn={lease.moveInReport} moveOut={{ ...report, zones }} />}

        <InspectionForm
          zones={zones}
          onChange={setZones}
          showDeductions
          onUploadPhoto={handleUploadPhoto}
          onDeletePhoto={handleDeletePhoto}
        />

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <span className="font-label-sm uppercase tracking-wider text-ink-muted">Autres retenues (optionnel)</span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Motif" htmlFor="otherNote" hint="Ex. arriérés de loyer, facture SONEB/SBEE">
              <Input id="otherNote" value={otherNote} onChange={(e) => setOtherNote(e.target.value)} />
            </Field>
            <Field label="Montant (FCFA)" htmlFor="otherAmount">
              <Input id="otherAmount" inputMode="numeric" value={otherAmount} onChange={(e) => setOtherAmount(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="font-label-sm text-ink-soft">Notes générales (optionnel)</label>
          <textarea
            value={generalNotes}
            onChange={(e) => setGeneralNotes(e.target.value)}
            rows={3}
            className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-4">
          <SummaryRow label="Caution initiale" value={formatFcfa(report.depositAmount)} />
          <SummaryRow label="Total des retenues" value={`- ${formatFcfa(totalDeductions)}`} danger={totalDeductions > 0} />
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <span className="font-label-md text-ink">Net à restituer au locataire</span>
            <span className="tabular font-currency-table text-headline-sm text-primary">{formatFcfa(netRefund)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" onClick={handleSave} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
          </Button>
        </div>

        <FinalizeSection onFinalize={handleFinalize} submitting={finalizing} error={finalizeError} />
      </CardContent>
    </Card>
  );
}

function FinalizedView({ lease, report }: { lease: Lease; report: MoveOutReport }) {
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
        <DownloadPvButton leaseId={lease.id} />

        {lease.moveInReport && <ComparisonSection moveIn={lease.moveInReport} moveOut={report} />}

        <InspectionReadOnly zones={report.zones} showDeductions />

        {report.otherDeductionsAmount > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-body-sm text-ink">{report.otherDeductionsNote || "Autres retenues"}</span>
            <span className="tabular text-body-sm text-danger-fg">- {formatFcfa(report.otherDeductionsAmount)}</span>
          </div>
        )}

        {report.generalNotes && (
          <div className="rounded-lg border border-border bg-surface-muted p-3">
            <p className="font-label-sm text-ink-muted">Notes générales</p>
            <p className="text-body-sm text-ink">{report.generalNotes}</p>
          </div>
        )}

        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-4">
          <SummaryRow label="Caution initiale" value={formatFcfa(report.depositAmount)} />
          <SummaryRow label="Total des retenues" value={`- ${formatFcfa(report.totalDeductions)}`} danger />
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <span className="font-label-md text-ink">Net à restituer</span>
            <span className="tabular font-currency-table text-headline-sm text-primary">{formatFcfa(report.netRefund)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SignatureBlock label="Signature du locataire" url={report.tenantSignatureUrl} />
          <SignatureBlock label="Signature de l'agent" url={report.agentSignatureUrl} />
        </div>
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
function ComparisonSection({ moveIn, moveOut }: { moveIn: NonNullable<Lease["moveInReport"]>; moveOut: MoveOutReport }) {
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

const COMPARISON_STATUS_LABEL: Record<ItemComparison["status"], string> = {
  degraded: "Dégradé",
  improved: "Amélioré",
  same: "Inchangé",
  unrated: "Non comparable",
  added: "Ajouté à la sortie",
  removed: "Absent à la sortie",
};

function ComparisonRow({ item }: { item: ItemComparison }) {
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

function DownloadPvButton({ leaseId }: { leaseId: number }) {
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

function SummaryRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-body-sm text-ink-soft">{label}</span>
      <span className={cn("tabular text-body-sm", danger ? "text-danger-fg" : "text-ink")}>{value}</span>
    </div>
  );
}
