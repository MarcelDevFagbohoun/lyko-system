"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, FileDown, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  getRenter,
  createMoveOutReport,
  moveOutReportPdfPath,
  type Lease,
  type MoveOutReportItem,
} from "@/lib/api/renters";
import { INSPECTION_ITEMS, INSPECTION_CONDITIONS, CONDITION_LABELS, type InspectionCondition } from "@/lib/constants/inspection";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { EspaceHeader } from "@/components/espace/espace-header";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken || !Number.isInteger(renterId) || !Number.isInteger(leaseId)) return;
    getRenter(accessToken, renterId)
      .then((res) => {
        setRenterName(`${res.renter.firstName} ${res.renter.lastName}`);
        const found = res.leases.find((l) => l.id === leaseId);
        if (!found) throw new ApiError(404, "Bail introuvable");
        setLease(found);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Impossible de charger le bail."));
  }, [accessToken, renterId, leaseId]);

  React.useEffect(() => load(), [load]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-canvas">
        <EspaceHeader />
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
        <EspaceHeader />
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <EspaceHeader />
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link
          href={`/espace/locataires/${renterId}`}
          className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={16} />
          Retour à la fiche de {renterName}
        </Link>

        {lease.moveOutReport ? (
          <ReadOnlyReport lease={lease} />
        ) : lease.status !== "active" ? (
          <Card className="max-w-2xl">
            <CardContent className="py-6 text-body-sm text-ink-muted">
              Ce bail est déjà terminé sans état des lieux de sortie enregistré (départ traité avant la mise en
              place de ce module). Aucun décompte de caution ne peut être généré rétroactivement.
            </CardContent>
          </Card>
        ) : (
          <ReportForm
            lease={lease}
            accessToken={accessToken}
            onDone={() => router.push(`/espace/locataires/${renterId}`)}
          />
        )}
      </div>
    </div>
  );
}

function conditionVariant(c: InspectionCondition) {
  if (c === "bon") return "success" as const;
  if (c === "moyen") return "warning" as const;
  return "danger" as const;
}

function ReadOnlyReport({ lease }: { lease: Lease }) {
  const report = lease.moveOutReport!;
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Décompte de sortie</CardTitle>
        <CardDescription>
          {lease.unit.designationLabel} ({lease.unit.code}) · sortie constatée le {report.conductedAt}
          {report.conductedBy && ` par ${report.conductedBy.name} (${report.conductedBy.roleLabel})`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DownloadPvButton leaseId={lease.id} />

        <div className="flex flex-col gap-3">
          {report.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="font-label-md text-ink">{item.label}</p>
                {item.comment && <p className="text-body-xs text-ink-muted">{item.comment}</p>}
              </div>
              <div className="flex items-center gap-2">
                {item.deduction > 0 && (
                  <span className="tabular text-body-sm text-danger-fg">- {formatFcfa(item.deduction)}</span>
                )}
                <Badge variant={conditionVariant(item.condition)}>{CONDITION_LABELS[item.condition]}</Badge>
              </div>
            </div>
          ))}
        </div>

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
            <span className="tabular font-currency-table text-headline-sm text-primary">
              {formatFcfa(report.netRefund)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
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

function ReportForm({
  lease,
  accessToken,
  onDone,
}: {
  lease: Lease;
  accessToken: string | null;
  onDone: () => void;
}) {
  const [conductedAt, setConductedAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = React.useState<MoveOutReportItem[]>(
    INSPECTION_ITEMS.map((label) => ({ label, condition: "bon", comment: null, deduction: 0 })),
  );
  const [generalNotes, setGeneralNotes] = React.useState("");
  const [otherAmount, setOtherAmount] = React.useState("");
  const [otherNote, setOtherNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function setCondition(index: number, condition: InspectionCondition) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, condition } : it)));
  }
  function setComment(index: number, comment: string) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, comment: comment || null } : it)));
  }
  function setDeduction(index: number, deduction: string) {
    const n = Number(deduction.replace(/\D/g, "")) || 0;
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, deduction: n } : it)));
  }

  const itemsTotal = items.reduce((sum, it) => sum + it.deduction, 0);
  const otherTotal = Number(otherAmount) || 0;
  const totalDeductions = itemsTotal + otherTotal;
  const netRefund = Math.max(0, lease.depositAmount - totalDeductions);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await createMoveOutReport(accessToken, lease.id, {
        conductedAt,
        items,
        generalNotes: generalNotes.trim() || undefined,
        otherDeductionsAmount: otherTotal || undefined,
        otherDeductionsNote: otherNote.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer la sortie.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Organiser la sortie</CardTitle>
        <CardDescription>
          {lease.unit.designationLabel} ({lease.unit.code}) · état des lieux contradictoire et décompte de caution.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}

          {lease.arrears?.status === "late" && (
            <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2.5 text-body-sm text-warning-fg">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                Loyer en retard de {lease.arrears.daysLate} jour(s) (échéance du {lease.arrears.dueDate}). Vous
                pouvez en tenir compte via « Autres retenues » ci-dessous si vous souhaitez le déduire de la
                caution.
              </span>
            </div>
          )}

          <Field label="Date de sortie" htmlFor="conductedAt" required>
            <Input id="conductedAt" type="date" value={conductedAt} onChange={(e) => setConductedAt(e.target.value)} />
          </Field>

          <div className="flex flex-col gap-3">
            {items.map((item, i) => (
              <div key={item.label} className="rounded-lg border border-border p-3">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <span className="font-label-md text-ink">{item.label}</span>
                  <div className="flex gap-1.5">
                    {INSPECTION_CONDITIONS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCondition(i, c)}
                        className={cn(
                          "rounded-full border px-3 py-1 font-label-sm transition-colors",
                          item.condition === c
                            ? "border-primary bg-surface-muted text-ink"
                            : "border-border text-ink-soft hover:bg-surface-hover",
                        )}
                      >
                        {CONDITION_LABELS[c]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    placeholder="Commentaire (optionnel)"
                    value={item.comment ?? ""}
                    onChange={(e) => setComment(i, e.target.value)}
                    className="h-8 flex-1 rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Retenue FCFA"
                    value={item.deduction || ""}
                    onChange={(e) => setDeduction(i, e.target.value)}
                    className="h-8 w-full rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-32"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">
              Autres retenues (optionnel)
            </span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Motif" htmlFor="otherNote" hint="Ex. arriérés de loyer, facture SONEB/SBEE">
                <Input id="otherNote" value={otherNote} onChange={(e) => setOtherNote(e.target.value)} />
              </Field>
              <Field label="Montant (FCFA)" htmlFor="otherAmount">
                <Input id="otherAmount" inputMode="numeric" value={otherAmount} onChange={(e) => setOtherAmount(e.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>
          </div>

          <Field label="Notes générales (optionnel)" htmlFor="generalNotes">
            <Input id="generalNotes" value={generalNotes} onChange={(e) => setGeneralNotes(e.target.value)} />
          </Field>

          <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-4">
            <SummaryRow label="Caution initiale" value={formatFcfa(lease.depositAmount)} />
            <SummaryRow label="Total des retenues" value={`- ${formatFcfa(totalDeductions)}`} danger={totalDeductions > 0} />
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <span className="font-label-md text-ink">Net à restituer au locataire</span>
              <span className="tabular font-currency-table text-headline-sm text-primary">{formatFcfa(netRefund)}</span>
            </div>
          </div>

          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? "Enregistrement…" : "Valider la sortie et clôturer le bail"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
