"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, Lock, RotateCcw, Trash2, Check } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  getUtilityBatch,
  saveUtilityBatch,
  validateUtilityBatch,
  reopenUtilityBatch,
  deleteUtilityBatch,
  type UtilityBatch,
} from "@/lib/api/charges";
import { UTILITY_TYPE_LABELS, BATCH_STATUS_LABELS, DIFFERENCE_ALERT_TEXT, LOSS_ALLOCATION_LABELS } from "@/lib/constants/charges";
import { formatFcfa, cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export function ReleveView() {
  return (
    <RequireAuth permission="charges">
      <ReleveContent />
    </RequireAuth>
  );
}

type RowDraft = { unitId: number; start: string; end: string };
const digits = (v: string) => v.replace(/\D/g, "");
const n = (v: string) => (v === "" ? null : Number(v));

function ReleveContent() {
  const { id } = useParams<{ id: string }>();
  const batchId = Number(id);
  const { accessToken } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [data, setData] = React.useState<UtilityBatch | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<RowDraft[]>([]);
  const [mainStart, setMainStart] = React.useState("");
  const [mainEnd, setMainEnd] = React.useState("");
  const [mainInvoice, setMainInvoice] = React.useState("");
  const [busy, setBusy] = React.useState<"save" | "validate" | "reopen" | "delete" | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [confirmValidate, setConfirmValidate] = React.useState(false);

  const seed = React.useCallback((b: UtilityBatch) => {
    setData(b);
    setRows(b.rows.map((r) => ({ unitId: r.unitId, start: String(r.readingStart), end: String(r.readingEnd) })));
    setMainStart(b.batch.main.readingStart != null ? String(b.batch.main.readingStart) : "");
    setMainEnd(b.batch.main.readingEnd != null ? String(b.batch.main.readingEnd) : "");
    setMainInvoice(b.batch.main.invoiceAmount != null ? String(b.batch.main.invoiceAmount) : "");
  }, []);

  React.useEffect(() => {
    if (!accessToken || !Number.isInteger(batchId)) return;
    getUtilityBatch(accessToken, batchId)
      .then(seed)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Relevé introuvable."));
  }, [accessToken, batchId, seed]);

  const draft = data?.batch.status === "brouillon";
  const unitPrice = data?.batch.unitPrice ?? 0;

  // Calcul en direct, miroir du backend.
  const computed = React.useMemo(() => {
    const perRow = rows.map((r) => {
      const s = n(r.start);
      const e = n(r.end);
      const cons = s != null && e != null && e >= s ? e - s : null;
      const amount = cons != null ? Math.round(cons * unitPrice) : null;
      return { unitId: r.unitId, cons, amount };
    });
    const subConsumption = perRow.reduce((a, r) => a + (r.cons ?? 0), 0);
    const subAmount = perRow.reduce((a, r) => a + (r.amount ?? 0), 0);
    const ms = n(mainStart);
    const me = n(mainEnd);
    const mainConsumption = ms != null && me != null && me >= ms ? me - ms : null;
    const mainAmount = n(mainInvoice);
    const differenceConsumption = mainConsumption != null ? mainConsumption - subConsumption : null;
    const differenceAmount = mainAmount != null ? mainAmount - subAmount : null;
    const pct = mainConsumption && mainConsumption > 0 && differenceConsumption != null ? differenceConsumption / mainConsumption : null;
    let alert: "none" | "high" | "negative" = "none";
    if (differenceConsumption != null && (differenceConsumption < 0 || (differenceAmount != null && differenceAmount < 0))) alert = "negative";
    else if (pct != null && pct > 0.15) alert = "high";
    return { perRow, subConsumption, subAmount, mainConsumption, mainAmount, differenceConsumption, differenceAmount, alert };
  }, [rows, mainStart, mainEnd, mainInvoice, unitPrice]);

  function setRow(unitId: number, patch: Partial<RowDraft>) {
    setRows((rs) => rs.map((r) => (r.unitId === unitId ? { ...r, ...patch } : r)));
  }

  async function persist(): Promise<UtilityBatch> {
    if (!accessToken) throw new Error("no token");
    return saveUtilityBatch(accessToken, batchId, {
      mainReadingStart: n(mainStart),
      mainReadingEnd: n(mainEnd),
      mainInvoiceAmount: n(mainInvoice),
      readings: rows.map((r) => ({ unitId: r.unitId, readingStart: Number(r.start || 0), readingEnd: Number(r.end || 0) })),
    });
  }

  async function handleSave() {
    setBusy("save");
    setActionError(null);
    try {
      seed(await persist());
      toast.success("Relevé enregistré.");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(null);
    }
  }

  async function handleValidate() {
    if (!accessToken) return;
    setBusy("validate");
    setActionError(null);
    try {
      await persist();
      seed(await validateUtilityBatch(accessToken, batchId));
      setConfirmValidate(false);
      toast.success("Relevé validé — les charges ont été générées.");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Validation impossible.");
    } finally {
      setBusy(null);
    }
  }

  async function handleReopen() {
    if (!accessToken) return;
    setBusy("reopen");
    setActionError(null);
    try {
      seed(await reopenUtilityBatch(accessToken, batchId));
      toast.info("Relevé rouvert.");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Réouverture impossible.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!accessToken) return;
    setBusy("delete");
    try {
      await deleteUtilityBatch(accessToken, batchId);
      toast.info("Relevé supprimé.");
      router.push("/espace/charges/releves");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Suppression impossible.");
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10">
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{loadError}</div>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  const b = data.batch;

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace/charges/releves" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour aux relevés
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-headline-xl text-ink">
              {b.propertyCode} · {UTILITY_TYPE_LABELS[b.utilityType]}
            </h1>
            <p className="text-body-md text-ink-soft">
              {b.periodStart} → {b.periodEnd} · tarif {formatFcfa(b.unitPrice)} / unité
            </p>
          </div>
          <Badge variant={b.status === "valide" ? "success" : "neutral"}>{BATCH_STATUS_LABELS[b.status]}</Badge>
        </div>

        {actionError && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{actionError}</div>
        )}

        {!draft && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm text-ink-soft">
            <Lock size={16} className="shrink-0" />
            Relevé validé le {b.validatedAt?.slice(0, 10)}. Les factures des locataires ont été générées. Rouvrez le relevé
            pour le modifier (les factures non payées seront supprimées).
          </div>
        )}

        <Table>
          <TableHeader>
            <tr>
              <TableHead>Unité</TableHead>
              <TableHead>Locataire</TableHead>
              <TableHead className="text-right">Ancien index</TableHead>
              <TableHead className="text-right">Nouvel index</TableHead>
              <TableHead className="text-right">Consommation</TableHead>
              <TableHead className="text-right">Montant</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => {
              const d = rows.find((x) => x.unitId === r.unitId);
              const c = computed.perRow.find((x) => x.unitId === r.unitId);
              return (
                <TableRow key={r.unitId}>
                  <TableCell>
                    <span className="font-label-md text-ink">{r.unitCode}</span>
                    <span className="block text-body-xs text-ink-muted">{r.unitLabel} · {r.meterNumber}</span>
                  </TableCell>
                  <TableCell className="text-ink-soft">
                    {r.renter ? `${r.renter.firstName} ${r.renter.lastName}` : <span className="text-ink-muted">Vacante</span>}
                    {r.charge && (
                      <Link
                        href="/espace/charges"
                        className={cn(
                          "ml-2 inline-flex text-body-xs",
                          r.charge.status === "payee" ? "text-success-fg" : "text-warning-fg",
                        )}
                      >
                        facture {r.charge.status === "payee" ? "payée" : "générée"}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {draft ? (
                      <input
                        inputMode="numeric"
                        value={d?.start ?? ""}
                        onChange={(e) => setRow(r.unitId, { start: digits(e.target.value) })}
                        className="w-24 rounded border border-border-strong bg-surface px-2 py-1 text-right text-body-sm tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    ) : (
                      <span className="tabular">{r.readingStart}</span>
                    )}
                    {r.previousReading != null && draft && d?.start !== String(r.previousReading) && (
                      <span className="ml-1 block text-body-xs text-ink-faint">préc. {r.previousReading}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {draft ? (
                      <input
                        inputMode="numeric"
                        value={d?.end ?? ""}
                        onChange={(e) => setRow(r.unitId, { end: digits(e.target.value) })}
                        className="w-24 rounded border border-border-strong bg-surface px-2 py-1 text-right text-body-sm tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    ) : (
                      <span className="tabular">{r.readingEnd}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular">{c?.cons ?? "—"}</TableCell>
                  <TableCell className="text-right tabular font-currency-table">
                    {c?.amount != null ? formatFcfa(c.amount) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}

            {/* Réconciliation : Total décompteur / Compteur principal / Différence (comme le tableur). */}
            <TableRow className="border-t-2 border-t-border-strong bg-surface-muted">
              <TableCell colSpan={4} className="text-right font-label-md text-ink">Total décompteur</TableCell>
              <TableCell className="text-right tabular font-label-md">{computed.subConsumption}</TableCell>
              <TableCell className="text-right tabular font-currency-table">{formatFcfa(computed.subAmount)}</TableCell>
            </TableRow>
            <TableRow className="bg-surface-muted">
              <TableCell colSpan={2}>
                <span className="font-label-md text-ink">Compteur principal</span>
                <span className="block text-body-xs text-ink-muted">Abonnement {UTILITY_TYPE_LABELS[b.utilityType]}</span>
              </TableCell>
              <TableCell className="text-right">
                {draft ? (
                  <input
                    inputMode="numeric"
                    value={mainStart}
                    onChange={(e) => setMainStart(digits(e.target.value))}
                    aria-label="Compteur principal — ancien index"
                    className="w-24 rounded border border-border-strong bg-surface px-2 py-1 text-right text-body-sm tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                ) : (
                  <span className="tabular">{b.main.readingStart ?? "—"}</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {draft ? (
                  <input
                    inputMode="numeric"
                    value={mainEnd}
                    onChange={(e) => setMainEnd(digits(e.target.value))}
                    aria-label="Compteur principal — nouvel index"
                    className="w-24 rounded border border-border-strong bg-surface px-2 py-1 text-right text-body-sm tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                ) : (
                  <span className="tabular">{b.main.readingEnd ?? "—"}</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular font-label-md">{computed.mainConsumption ?? "—"}</TableCell>
              <TableCell className="text-right">
                {draft ? (
                  <input
                    inputMode="numeric"
                    value={mainInvoice}
                    onChange={(e) => setMainInvoice(digits(e.target.value))}
                    placeholder="Facture reçue"
                    aria-label="Montant de la facture reçue"
                    className="w-28 rounded border border-border-strong bg-surface px-2 py-1 text-right text-body-sm tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                ) : (
                  <span className="tabular font-currency-table">
                    {b.main.invoiceAmount != null ? formatFcfa(b.main.invoiceAmount) : "—"}
                  </span>
                )}
              </TableCell>
            </TableRow>
            <TableRow
              className={cn(
                "border-t-2",
                computed.alert === "negative"
                  ? "border-t-danger-strong bg-danger/5"
                  : computed.alert === "high"
                    ? "border-t-warning-strong bg-warning/5"
                    : "border-t-border-strong",
              )}
            >
              <TableCell colSpan={4} className="text-right font-label-md text-ink">Différence compteur − décompteur</TableCell>
              <TableCell className="text-right tabular font-label-md">
                {computed.differenceConsumption ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular font-currency-table">
                {computed.differenceAmount != null ? formatFcfa(computed.differenceAmount) : "—"}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {computed.differenceAmount != null && computed.differenceAmount > 0 && (
          <p className="text-body-xs text-ink-muted">
            Répartition de cet écart : {LOSS_ALLOCATION_LABELS[b.lossAllocation]}
            {b.lossAllocation === "prorata" && " — ajoutée à la facture de chaque locataire à la validation."}
          </p>
        )}

        {computed.alert !== "none" && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-body-sm",
              computed.alert === "negative"
                ? "border-danger-border bg-danger-bg text-danger-fg"
                : "border-warning-border bg-warning-bg text-warning-fg",
            )}
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{DIFFERENCE_ALERT_TEXT[computed.alert]}</span>
          </div>
        )}

        {draft ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSave} disabled={busy !== null} variant="info">
              {busy === "save" ? "Enregistrement…" : "Enregistrer le brouillon"}
            </Button>
            {confirmValidate ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
                <span className="text-body-sm text-ink">Valider ? Les factures des locataires seront générées.</span>
                <Button size="sm" onClick={handleValidate} disabled={busy !== null}>
                  <Check size={14} />
                  {busy === "validate" ? "…" : "Confirmer"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmValidate(false)} disabled={busy !== null}>
                  Annuler
                </Button>
              </div>
            ) : (
              <Button onClick={() => setConfirmValidate(true)} disabled={busy !== null}>
                Valider le relevé
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleDelete} disabled={busy !== null} className="ml-auto text-danger-fg">
              <Trash2 size={14} />
              Supprimer
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="warning" onClick={handleReopen} disabled={busy !== null}>
              <RotateCcw size={14} />
              {busy === "reopen" ? "Réouverture…" : "Rouvrir le relevé"}
            </Button>
          </div>
        )}

        <Card>
          <CardContent className="py-3 text-body-xs text-ink-muted">
            Créé par {b.recordedBy?.name ?? "—"}{b.recordedBy ? ` (${b.recordedBy.roleLabel})` : ""}. Les unités sans
            locataire (vacantes) ou sans numéro de compteur ne génèrent pas de facture mais comptent dans le total
            décompteur.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
