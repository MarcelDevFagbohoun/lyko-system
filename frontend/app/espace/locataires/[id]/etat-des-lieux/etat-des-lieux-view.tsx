"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { getRenter, createMoveInReport, type Lease, type MoveInReportItem } from "@/lib/api/renters";
import { INSPECTION_ITEMS, INSPECTION_CONDITIONS, CONDITION_LABELS, type InspectionCondition } from "@/lib/constants/inspection";
import { RequireAuth } from "@/components/auth/require-auth";
import { EspaceHeader } from "@/components/espace/espace-header";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
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

        {lease.moveInReport ? (
          <ReadOnlyReport lease={lease} />
        ) : (
          <ReportForm
            leaseId={lease.id}
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
  const report = lease.moveInReport!;
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>État des lieux d&apos;entrée</CardTitle>
        <CardDescription>
          {lease.unit.designationLabel} ({lease.unit.code}) · réalisé le {report.conductedAt}
          {report.conductedBy && ` par ${report.conductedBy.name} (${report.conductedBy.roleLabel})`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {report.items.map((item, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="font-label-md text-ink">{item.label}</p>
              {item.comment && <p className="text-body-xs text-ink-muted">{item.comment}</p>}
            </div>
            <Badge variant={conditionVariant(item.condition)}>{CONDITION_LABELS[item.condition]}</Badge>
          </div>
        ))}
        {report.generalNotes && (
          <div className="rounded-lg border border-border bg-surface-muted p-3">
            <p className="font-label-sm text-ink-muted">Notes générales</p>
            <p className="text-body-sm text-ink">{report.generalNotes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportForm({
  leaseId,
  accessToken,
  onDone,
}: {
  leaseId: number;
  accessToken: string | null;
  onDone: () => void;
}) {
  const [conductedAt, setConductedAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = React.useState<MoveInReportItem[]>(
    INSPECTION_ITEMS.map((label) => ({ label, condition: "bon", comment: null })),
  );
  const [generalNotes, setGeneralNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function setCondition(index: number, condition: InspectionCondition) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, condition } : it)));
  }
  function setComment(index: number, comment: string) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, comment: comment || null } : it)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await createMoveInReport(accessToken, leaseId, { conductedAt, items, generalNotes: generalNotes.trim() || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer l'état des lieux.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>État des lieux d&apos;entrée</CardTitle>
        <CardDescription>Évaluez chaque poste au moment de la remise des clés.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}

          <Field label="Date de l'état des lieux" htmlFor="conductedAt" required>
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
                <input
                  type="text"
                  placeholder="Commentaire (optionnel)"
                  value={item.comment ?? ""}
                  onChange={(e) => setComment(i, e.target.value)}
                  className="mt-2 h-8 w-full rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
            ))}
          </div>

          <Field label="Notes générales (optionnel)" htmlFor="generalNotes">
            <Input id="generalNotes" value={generalNotes} onChange={(e) => setGeneralNotes(e.target.value)} />
          </Field>

          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? "Enregistrement…" : "Valider l'état des lieux"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
