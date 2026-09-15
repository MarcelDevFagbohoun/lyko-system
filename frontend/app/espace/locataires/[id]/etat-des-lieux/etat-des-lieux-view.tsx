"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  getRenter,
  startMoveInReport,
  updateMoveInReport,
  uploadInspectionItemPhoto,
  deleteInspectionItemPhoto,
  finalizeMoveInReport,
  type Lease,
  type InspectionReport,
  type InspectionZone,
} from "@/lib/api/renters";
import { RequireAuth } from "@/components/auth/require-auth";
import { InspectionForm } from "@/components/inspections/inspection-form";
import { InspectionReadOnly } from "@/components/inspections/inspection-readonly";
import { FinalizeSection } from "@/components/inspections/finalize-section";
import { SignatureBlock } from "@/components/inspections/signature-block";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";

export function EtatDesLieuxView() {
  return (
    <RequireAuth permission="etats_des_lieux">
      <EtatDesLieuxContent />
    </RequireAuth>
  );
}

function EtatDesLieuxContent() {
  const { id } = useParams<{ id: string }>();
  const renterId = Number(id);
  const searchParams = useSearchParams();
  const leaseId = Number(searchParams.get("leaseId"));
  const router = useRouter();
  const { accessToken } = useAuth();

  const [lease, setLease] = React.useState<Lease | null>(null);
  const [renterName, setRenterName] = React.useState("");
  const [report, setReport] = React.useState<InspectionReport | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken || !Number.isInteger(renterId) || !Number.isInteger(leaseId)) return;
    getRenter(accessToken, renterId)
      .then((res) => {
        setRenterName(`${res.renter.firstName} ${res.renter.lastName}`);
        const found = res.leases.find((l) => l.id === leaseId);
        if (!found) throw new ApiError(404, "Bail introuvable");
        setLease(found);
        setReport(found.moveInReport);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Impossible de charger le bail."));
  }, [accessToken, renterId, leaseId]);

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

        {!report ? (
          <StartCard leaseId={leaseId} accessToken={accessToken} onStarted={setReport} />
        ) : report.status === "finalized" ? (
          <FinalizedView lease={lease} report={report} />
        ) : (
          <DraftEditor
            leaseId={leaseId}
            lease={lease}
            report={report}
            accessToken={accessToken}
            onReportChange={setReport}
            onFinalized={() => router.push(`/espace/locataires/${renterId}`)}
          />
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
  onStarted: (report: InspectionReport) => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleStart() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await startMoveInReport(accessToken, leaseId);
      onStarted(res.report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de démarrer l'état des lieux.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <ClipboardList size={28} className="text-ink-muted" />
        <p className="font-label-md text-ink">Aucun état des lieux d&apos;entrée pour ce bail</p>
        <p className="text-body-sm text-ink-muted">
          La fiche est organisée par zones (devanture, chambre, salon…) avec un état par élément.
        </p>
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <Button onClick={handleStart} disabled={submitting}>
          {submitting ? "Démarrage…" : "Commencer l'état des lieux d'entrée"}
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
  report: InspectionReport;
  accessToken: string | null;
  onReportChange: (report: InspectionReport) => void;
  onFinalized: () => void;
}) {
  const [zones, setZones] = React.useState<InspectionZone[]>(report.zones);
  const [generalNotes, setGeneralNotes] = React.useState(report.generalNotes ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [finalizing, setFinalizing] = React.useState(false);
  const [finalizeError, setFinalizeError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSave() {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const res = await updateMoveInReport(accessToken, leaseId, { zones, generalNotes: generalNotes.trim() || undefined });
      onReportChange(res.report);
      setZones(res.report.zones);
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
      const res = await uploadInspectionItemPhoto(accessToken, "move-in", leaseId, zoneKey, itemKey, file);
      onReportChange(res.report);
      setZones(res.report.zones);
      toast.success("Photo envoyée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer la photo.");
    }
  }

  async function handleDeletePhoto(zoneKey: string, itemKey: string) {
    if (!accessToken) return;
    try {
      const res = await deleteInspectionItemPhoto(accessToken, "move-in", leaseId, zoneKey, itemKey);
      onReportChange(res.report);
      setZones(res.report.zones);
      toast.info("Photo retirée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de retirer la photo.");
    }
  }

  async function handleFinalize(tenantSignature: Blob, agentSignature: Blob) {
    if (!accessToken) return;
    // La finalisation exige les données déjà enregistrées côté serveur — on
    // sauvegarde silencieusement le brouillon courant juste avant, pour ne
    // jamais finaliser une version en retard sur ce qui est affiché à l'écran.
    setFinalizing(true);
    setFinalizeError(null);
    try {
      await updateMoveInReport(accessToken, leaseId, { zones, generalNotes: generalNotes.trim() || undefined });
      const res = await finalizeMoveInReport(accessToken, leaseId, tenantSignature, agentSignature);
      onReportChange(res.report);
      toast.success("État des lieux d'entrée finalisé et verrouillé.");
      onFinalized();
    } catch (err) {
      setFinalizeError(err instanceof ApiError ? err.message : "Impossible de finaliser la fiche.");
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>État des lieux d&apos;entrée — brouillon</CardTitle>
        <CardDescription>
          {lease.unit.designationLabel} ({lease.unit.code}) · évaluez chaque élément, puis finalisez avec les signatures.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        <InspectionForm
          zones={zones}
          onChange={setZones}
          showDeductions={false}
          onUploadPhoto={handleUploadPhoto}
          onDeletePhoto={handleDeletePhoto}
        />

        <div className="flex flex-col gap-2">
          <label className="font-label-sm text-ink-soft">Notes générales (optionnel)</label>
          <textarea
            value={generalNotes}
            onChange={(e) => setGeneralNotes(e.target.value)}
            rows={3}
            className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
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

function FinalizedView({ lease, report }: { lease: Lease; report: InspectionReport }) {
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>État des lieux d&apos;entrée</CardTitle>
        <CardDescription>
          {lease.unit.designationLabel} ({lease.unit.code}) · réalisé le {report.conductedAt}
          {report.conductedBy && ` par ${report.conductedBy.name} (${report.conductedBy.roleLabel})`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <InspectionReadOnly zones={report.zones} showDeductions={false} />

        {report.generalNotes && (
          <div className="rounded-lg border border-border bg-surface-muted p-3">
            <p className="font-label-sm text-ink-muted">Notes générales</p>
            <p className="text-body-sm text-ink">{report.generalNotes}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SignatureBlock label="Signature du locataire" url={report.tenantSignatureUrl} />
          <SignatureBlock label="Signature de l'agent" url={report.agentSignatureUrl} />
        </div>
        {report.finalizedAt && (
          <p className="text-body-xs text-ink-muted">
            Finalisée le {new Date(report.finalizedAt).toLocaleDateString("fr-FR")}
            {report.finalizedBy && ` par ${report.finalizedBy.name} (${report.finalizedBy.roleLabel})`}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
