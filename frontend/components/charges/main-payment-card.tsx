"use client";

import * as React from "react";
import Link from "next/link";
import { Landmark, Pencil, X } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { deleteMainPayment, saveMainPayment, type MainPaymentMethod, type UtilityBatch } from "@/lib/api/charges";
import { formatFcfa } from "@/lib/utils";
import { useToast } from "@/lib/toast/toast-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const METHODS: { value: MainPaymentMethod; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];
const METHOD_LABELS = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<MainPaymentMethod, string>;

const POINT_STATUS: Record<string, { label: string; variant: "neutral" | "warning" | "danger" | "success" }> = {
  paiement_non_renseigne: { label: "Paiement à déclarer", variant: "neutral" },
  a_recouvrer: { label: "À recouvrer", variant: "warning" },
  a_charge_proprietaire: { label: "À charge du propriétaire", variant: "danger" },
  solde: { label: "Soldé", variant: "success" },
};

const digits = (v: string) => v.replace(/\D/g, "");
const inputCls =
  "rounded border border-border-strong bg-surface px-2 py-1.5 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Paiement de la facture mère (étape 30) : le propriétaire règle lui-même la
 * SONEB/SBEE, le cabinet le note ici pour faire le point avec ses
 * encaissements. Simple mémo — aucun mouvement de caisse du cabinet.
 */
export function MainPaymentCard({ data, onChange }: { data: UtilityBatch; onChange: (b: UtilityBatch) => void }) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const payment = data.batch.main.payment;
  const point = data.point;

  const [editing, setEditing] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [paidAt, setPaidAt] = React.useState(todayIso());
  const [method, setMethod] = React.useState<MainPaymentMethod | "">("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function openForm() {
    setAmount(String(payment?.amount ?? data.batch.main.invoiceAmount ?? ""));
    setPaidAt(payment?.paidAt ?? todayIso());
    setMethod(payment?.paymentMethod ?? "");
    setNotes(payment?.notes ?? "");
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (!accessToken) return;
    if (!amount || Number(amount) <= 0) {
      setError("Indiquez le montant réellement payé.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await saveMainPayment(accessToken, data.batch.id, {
        amount: Number(amount),
        paidAt,
        ...(method ? { paymentMethod: method } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onChange(res);
      setEditing(false);
      toast.success("Paiement de la facture mère enregistré.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await deleteMainPayment(accessToken, data.batch.id));
      toast.info("Déclaration de paiement annulée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Annulation impossible.");
    } finally {
      setBusy(false);
    }
  }

  const status = point ? POINT_STATUS[point.status] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark size={18} className="text-primary" />
          Facture mère payée par le propriétaire
        </CardTitle>
        <CardDescription>
          Le propriétaire règle lui-même la facture à la SONEB/SBEE. Notez-le ici pour faire le point avec ce que vous
          encaissez chez les locataires.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>}

        {editing ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-label-sm text-ink-muted">
                Montant payé (FCFA)
                <input inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} className={`${inputCls} w-36 text-right tabular`} />
              </label>
              <label className="flex flex-col gap-1 text-label-sm text-ink-muted">
                Date du paiement
                <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-label-sm text-ink-muted">
                Mode (facultatif)
                <select value={method} onChange={(e) => setMethod(e.target.value as MainPaymentMethod | "")} className={inputCls}>
                  <option value="">Non précisé</option>
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-label-sm text-ink-muted">
                Note (facultatif)
                <input value={notes} maxLength={255} onChange={(e) => setNotes(e.target.value)} placeholder="N° de quittance SONEB/SBEE…" className={inputCls} />
              </label>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={busy}>
                {busy ? "Enregistrement…" : "Enregistrer"}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                Annuler
              </Button>
            </div>
          </div>
        ) : payment ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="tabular font-currency-table text-headline-md text-ink">{formatFcfa(payment.amount)}</p>
              <p className="text-body-sm text-ink-soft">
                Payée le {payment.paidAt}
                {payment.paymentMethod ? ` · ${METHOD_LABELS[payment.paymentMethod]}` : ""}
                {data.batch.main.invoiceAmount != null && payment.amount !== data.batch.main.invoiceAmount && (
                  <span className="text-warning-fg"> · différent de la facture reçue ({formatFcfa(data.batch.main.invoiceAmount)})</span>
                )}
              </p>
              {payment.notes && <p className="text-body-xs text-ink-muted">{payment.notes}</p>}
              <p className="text-body-xs text-ink-muted">
                Déclaré par {payment.recordedBy?.name ?? "—"}
                {payment.recordedAt ? ` le ${payment.recordedAt.slice(0, 10)}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={openForm} disabled={busy}>
                <Pencil size={14} />
                Corriger
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCancel} disabled={busy} className="text-danger-fg">
                <X size={14} />
                Annuler la déclaration
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-body-sm text-ink-soft">Aucun paiement déclaré pour cette facture mère.</p>
            <Button onClick={openForm}>Déclarer le paiement</Button>
          </div>
        )}

        {point && (
          <div className="rounded-lg border border-border bg-surface-muted p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="font-label-md text-ink">Le point de ce relevé</span>
              {status && <Badge variant={status.variant}>{status.label}</Badge>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm sm:grid-cols-5">
              <PointItem label="Facturé aux locataires" value={formatFcfa(point.billed)} />
              <PointItem label="Encaissé" value={formatFcfa(point.collected)} />
              <PointItem label="Impayés locataires" value={formatFcfa(point.tenantUnpaid)} tone={point.tenantUnpaid > 0 ? "warning" : undefined} />
              <PointItem label="Non refacturé" value={point.nonRebilled != null ? formatFcfa(point.nonRebilled) : "—"} />
              <PointItem label="Reste au propriétaire" value={point.gap != null ? formatFcfa(point.gap) : "—"} tone={point.gap != null && point.gap > 0 ? "danger" : undefined} />
            </dl>
            <Link href="/espace/charges/point" className="mt-3 inline-block text-body-xs text-primary hover:underline">
              Voir le point de tous les propriétaires
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PointItem({ label, value, tone }: { label: string; value: string; tone?: "warning" | "danger" }) {
  return (
    <div>
      <dt className="text-body-xs text-ink-muted">{label}</dt>
      <dd className={`tabular font-currency-table ${tone === "danger" ? "text-danger-fg" : tone === "warning" ? "text-warning-fg" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
