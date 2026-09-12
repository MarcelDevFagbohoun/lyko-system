"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { getRenter, type Lease } from "@/lib/api/renters";
import type { RenterListItem } from "@/lib/api/renters";
import { createCharge, type UtilityType } from "@/lib/api/charges";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { EspaceHeader } from "@/components/espace/espace-header";
import { RenterLeasePicker } from "@/components/complaints/renter-lease-picker";
import { OfflineNotice } from "@/components/system/offline-notice";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const todayIso = () => new Date().toISOString().slice(0, 10);

export function NouveauView() {
  return (
    <RequireAuth permission="charges">
      <NouveauContent />
    </RequireAuth>
  );
}

function NouveauContent() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const online = useOnlineStatus();
  const searchParams = useSearchParams();
  const prefillRenterId = Number(searchParams.get("renterId"));
  const hasPrefill = Number.isInteger(prefillRenterId) && prefillRenterId > 0;

  const [prefillRenter, setPrefillRenter] = React.useState<{ name: string; lease: Lease } | null>(null);
  const [prefillError, setPrefillError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken || !hasPrefill) return;
    getRenter(accessToken, prefillRenterId)
      .then((res) => {
        const active = res.leases.find((l) => l.status === "active");
        if (!active) throw new ApiError(400, "Ce locataire n'a pas de bail actif.");
        setPrefillRenter({ name: `${res.renter.firstName} ${res.renter.lastName}`, lease: active });
      })
      .catch((err) => setPrefillError(err instanceof ApiError ? err.message : "Impossible de charger ce locataire."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, hasPrefill]);

  const [selectedRenter, setSelectedRenter] = React.useState<RenterListItem | null>(null);
  const leaseId = hasPrefill ? prefillRenter?.lease.id ?? null : selectedRenter?.activeLease?.id ?? null;

  const [utilityType, setUtilityType] = React.useState<UtilityType>("soneb");
  const [periodStart, setPeriodStart] = React.useState("");
  const [periodEnd, setPeriodEnd] = React.useState("");
  const [readingStart, setReadingStart] = React.useState("");
  const [readingEnd, setReadingEnd] = React.useState("");
  const [unitPrice, setUnitPrice] = React.useState("");
  const [billedAt, setBilledAt] = React.useState(todayIso());
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const consumption =
    readingStart !== "" && readingEnd !== "" && Number(readingEnd) >= Number(readingStart)
      ? Number(readingEnd) - Number(readingStart)
      : null;
  const computedAmount = consumption !== null && unitPrice ? Math.round(consumption * Number(unitPrice)) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !leaseId) return setError("Sélectionnez un locataire avec bail actif.");
    if (!periodStart || !periodEnd) return setError("Début et fin de période requis.");
    if (periodEnd < periodStart) return setError("La fin de période doit être postérieure au début.");
    if (readingStart === "" || readingEnd === "") return setError("Les index de début et de fin sont obligatoires.");
    if (Number(readingEnd) < Number(readingStart)) return setError("L'index de fin doit être supérieur ou égal à l'index de début.");
    if (!unitPrice || Number(unitPrice) <= 0) return setError("Prix unitaire requis.");

    setSubmitting(true);
    setError(null);
    try {
      await createCharge(accessToken, {
        leaseId,
        utilityType,
        periodStart,
        periodEnd,
        readingStart: Number(readingStart),
        readingEnd: Number(readingEnd),
        unitPrice: Number(unitPrice),
        billedAt,
        notes: notes.trim() || undefined,
      });
      router.push("/espace/charges");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <EspaceHeader />
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace/charges" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour aux charges
        </Link>

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Enregistrer une facture SONEB / SBEE</CardTitle>
            <CardDescription>
              Le montant est calculé automatiquement : consommation (index fin − index début) × prix unitaire.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
              {!online && <OfflineNotice action="l'enregistrement d'une charge" />}
              {error && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {error}
                </div>
              )}
              {prefillError && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {prefillError}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <span className="font-label-sm uppercase tracking-wider text-ink-muted">Locataire concerné</span>
                {hasPrefill ? (
                  prefillRenter ? (
                    <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm text-ink">
                      {prefillRenter.name} — {prefillRenter.lease.unit.designationLabel} ({prefillRenter.lease.unit.code})
                    </p>
                  ) : (
                    <p className="text-body-sm text-ink-muted">Chargement…</p>
                  )
                ) : (
                  <RenterLeasePicker
                    accessToken={accessToken}
                    selectedRenterId={selectedRenter?.id ?? null}
                    onSelect={setSelectedRenter}
                  />
                )}
              </div>

              <Field label="Fluide" htmlFor="utilityType" required>
                <select
                  id="utilityType"
                  value={utilityType}
                  onChange={(e) => setUtilityType(e.target.value as UtilityType)}
                  className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="soneb">SONEB (Eau)</option>
                  <option value="sbee">SBEE (Électricité)</option>
                </select>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Début de période" htmlFor="periodStart" required>
                  <Input id="periodStart" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                </Field>
                <Field label="Fin de période" htmlFor="periodEnd" required>
                  <Input id="periodEnd" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Index début" htmlFor="readingStart" required>
                  <Input id="readingStart" inputMode="numeric" value={readingStart} onChange={(e) => setReadingStart(e.target.value.replace(/\D/g, ""))} />
                </Field>
                <Field label="Index fin" htmlFor="readingEnd" required hint={consumption !== null ? `Consommation : ${consumption} unité(s)` : undefined}>
                  <Input id="readingEnd" inputMode="numeric" value={readingEnd} onChange={(e) => setReadingEnd(e.target.value.replace(/\D/g, ""))} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Prix unitaire (FCFA)" htmlFor="unitPrice" required hint="Prix par unité de consommation">
                  <Input id="unitPrice" inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
                </Field>
                <Field label="Date de facturation" htmlFor="billedAt" required>
                  <Input id="billedAt" type="date" value={billedAt} onChange={(e) => setBilledAt(e.target.value)} />
                </Field>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted px-4 py-3">
                <span className="font-label-md text-ink">Montant à facturer</span>
                <span className="tabular font-currency-table text-headline-sm text-primary">
                  {computedAmount !== null ? formatFcfa(computedAmount) : "—"}
                </span>
              </div>

              <Field label="Note (optionnel)" htmlFor="notes">
                <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>

              <Button type="submit" size="lg" disabled={submitting || !leaseId || !online}>
                {submitting
                  ? "Enregistrement…"
                  : !online
                    ? "Indisponible hors-ligne"
                    : !leaseId
                      ? "Sélectionnez un locataire"
                      : "Enregistrer la facture"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
