"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Gauge, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { listProperties, type PropertyListItem } from "@/lib/api/properties";
import {
  listUtilityBatches,
  createUtilityBatch,
  type UtilityBatchSummary,
  type UtilityType,
} from "@/lib/api/charges";
import { UTILITY_TYPE_LABELS, BATCH_STATUS_LABELS } from "@/lib/constants/charges";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { EspaceHeader } from "@/components/espace/espace-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export function RelevesView() {
  return (
    <RequireAuth permission="charges">
      <RelevesContent />
    </RequireAuth>
  );
}

function submeteredTypes(p: PropertyListItem): UtilityType[] {
  const t: UtilityType[] = [];
  if (p.utilityConfig?.soneb?.submetered) t.push("soneb");
  if (p.utilityConfig?.sbee?.submetered) t.push("sbee");
  return t;
}

function RelevesContent() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [properties, setProperties] = React.useState<PropertyListItem[] | null>(null);
  const [propertyId, setPropertyId] = React.useState<number | null>(null);
  const [batches, setBatches] = React.useState<UtilityBatchSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken) return;
    listProperties(accessToken)
      .then((res) => {
        const submetered = res.properties.filter((p) => submeteredTypes(p).length > 0);
        setProperties(submetered);
        if (submetered.length > 0) setPropertyId(submetered[0].id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les biens."));
  }, [accessToken]);

  const loadBatches = React.useCallback(() => {
    if (!accessToken || !propertyId) return;
    listUtilityBatches(accessToken, propertyId)
      .then((res) => setBatches(res.batches))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les relevés."));
  }, [accessToken, propertyId]);

  React.useEffect(() => {
    setBatches(null);
    setShowForm(false);
    loadBatches();
  }, [loadBatches]);

  const selected = properties?.find((p) => p.id === propertyId) ?? null;

  return (
    <div className="min-h-screen bg-canvas">
      <EspaceHeader />
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace/charges" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour aux charges
        </Link>

        <div>
          <h1 className="font-display text-headline-xl text-ink">Relevés de compteurs par immeuble</h1>
          <p className="text-body-md text-ink-soft">
            Relevez tous les décompteurs d&apos;un immeuble en une fois, saisissez le compteur principal et la facture
            reçue, puis validez pour générer les factures des locataires.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>
        )}

        {properties && properties.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Gauge size={28} className="text-ink-muted" />
              <p className="font-label-md text-ink">Aucun immeuble n&apos;a le sous-comptage activé</p>
              <p className="max-w-md text-body-sm text-ink-muted">
                Ouvrez la fiche d&apos;un bien, section « Compteurs & fluides », pour activer le sous-comptage SONEB
                ou SBEE et définir le tarif au m³ / kWh.
              </p>
              <Link href="/espace/biens">
                <Button variant="secondary">Voir mes biens</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {properties && properties.length > 0 && selected && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Immeuble" htmlFor="propertyPick">
                <select
                  id="propertyPick"
                  value={propertyId ?? ""}
                  onChange={(e) => setPropertyId(Number(e.target.value))}
                  className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.owner.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Button onClick={() => setShowForm((v) => !v)}>
                <Plus size={16} />
                {showForm ? "Fermer" : "Nouveau relevé"}
              </Button>
            </div>

            {showForm && (
              <NewBatchForm
                accessToken={accessToken}
                propertyId={selected.id}
                types={submeteredTypes(selected)}
                onCreated={(id) => router.push(`/espace/charges/releve/${id}`)}
              />
            )}

            {batches === null ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : batches.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucun relevé pour cet immeuble.</p>
            ) : (
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Période</TableHead>
                    <TableHead>Fluide</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Total décompteur</TableHead>
                    <TableHead className="text-right">Compteur</TableHead>
                    <TableHead className="text-right">Différence</TableHead>
                    <TableHead />
                  </tr>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="text-ink-soft">{b.periodStart} → {b.periodEnd}</TableCell>
                      <TableCell className="text-ink-soft">{UTILITY_TYPE_LABELS[b.utilityType]}</TableCell>
                      <TableCell>
                        <Badge variant={b.status === "valide" ? "success" : "neutral"}>{BATCH_STATUS_LABELS[b.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular">{formatFcfa(b.subAmount)}</TableCell>
                      <TableCell className="text-right tabular">
                        {b.mainAmount != null ? formatFcfa(b.mainAmount) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {b.differenceAmount != null ? (
                          <span className={b.differenceAmount < 0 ? "text-danger-fg" : "text-ink"}>
                            {formatFcfa(b.differenceAmount)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/espace/charges/releve/${b.id}`}
                          className="inline-flex items-center gap-1 text-body-sm text-primary hover:underline"
                        >
                          Ouvrir <ArrowRight size={14} />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NewBatchForm({
  accessToken,
  propertyId,
  types,
  onCreated,
}: {
  accessToken: string | null;
  propertyId: number;
  types: UtilityType[];
  onCreated: (batchId: number) => void;
}) {
  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [utilityType, setUtilityType] = React.useState<UtilityType>(types[0]);
  const [periodStart, setPeriodStart] = React.useState(firstOfMonth);
  const [periodEnd, setPeriodEnd] = React.useState(lastOfMonth);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createUtilityBatch(accessToken, propertyId, { utilityType, periodStart, periodEnd });
      onCreated(res.batch.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer le relevé.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Fluide" htmlFor="nbType">
          <select
            id="nbType"
            value={utilityType}
            onChange={(e) => setUtilityType(e.target.value as UtilityType)}
            className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink"
          >
            {types.map((t) => (
              <option key={t} value={t}>{UTILITY_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Début de période" htmlFor="nbStart">
          <Input id="nbStart" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </Field>
        <Field label="Fin de période" htmlFor="nbEnd">
          <Input id="nbEnd" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={submitting}>
        {submitting ? "Création…" : "Créer le relevé"}
      </Button>
    </form>
  );
}
