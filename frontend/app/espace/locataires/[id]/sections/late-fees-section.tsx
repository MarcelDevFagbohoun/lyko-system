"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import {
  listLateFees,
  payLateFee,
  type PaymentMethod,
  type LateFee,
} from "@/lib/api/renters";
import { formatFcfa } from "@/lib/utils";
import { useToast } from "@/lib/toast/toast-context";
import { Badge } from "@/components/ui/badge";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PAYMENT_METHODS } from "./opening-debt-section";

/**
 * Pénalités de retard déjà appliquées — l'action « Appliquer une pénalité »
 * vit dans le Centre de relance, à côté de la relance WhatsApp du même
 * locataire ; ici, chacune affiche désormais son statut de règlement (étape
 * 44bis : une pénalité peut être réglée totalement ou partiellement, comme
 * les impayés à l'entrée ci-dessous) avec un formulaire pour l'enregistrer.
 */
export function LateFeesSection({ leaseId, accessToken, canManage }: { leaseId: number; accessToken: string | null; canManage: boolean }) {
  const [lateFees, setLateFees] = React.useState<LateFee[] | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listLateFees(accessToken, leaseId).then((res) => setLateFees(res.lateFees));
  }, [accessToken, leaseId]);

  React.useEffect(() => load(), [load]);

  if (lateFees !== null && lateFees.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">Pénalités de retard appliquées</span>
      {lateFees === null ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {lateFees.map((f) => (
            <LateFeeRow key={f.id} leaseId={leaseId} lateFee={f} accessToken={accessToken} canManage={canManage} onSettled={load} />
          ))}
        </div>
      )}
    </div>
  );
}

export const LATE_FEE_STATUS_BADGE = {
  impayee: { variant: "danger" as const, label: "Impayée" },
  partielle: { variant: "warning" as const, label: "Partielle" },
  payee: { variant: "success" as const, label: "Payée" },
};

export function LateFeeRow({
  leaseId,
  lateFee,
  accessToken,
  canManage,
  onSettled,
}: {
  leaseId: number;
  lateFee: LateFee;
  accessToken: string | null;
  canManage: boolean;
  onSettled: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState(String(lateFee.remaining));
  const [method, setMethod] = React.useState<PaymentMethod>("mobile_money");
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const idem = useIdempotencyKey();
  const badge = LATE_FEE_STATUS_BADGE[lateFee.status];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await payLateFee(accessToken, leaseId, lateFee.id, {
        amount: Number(amount),
        paymentMethod: method,
        paidAt,
        notes: notes.trim() || undefined,
        idempotencyKey: idem.key,
      });
      idem.renew();
      setOpen(false);
      setNotes("");
      toast.success(`${formatFcfa(Number(amount))} réglés sur cette pénalité, ajoutés à la recette de l'entreprise.`);
      onSettled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce règlement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-label-sm text-ink">{lateFee.reason || "Pénalité de retard"}</p>
          <p className="text-body-xs text-ink-muted">
            Appliquée le {lateFee.appliedAt}
            {lateFee.appliedBy && ` par ${lateFee.appliedBy.name} (${lateFee.appliedBy.roleLabel})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="tabular font-currency-table text-body-sm text-danger-fg">{formatFcfa(lateFee.amount)}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </div>
      {lateFee.status !== "payee" && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-body-xs text-ink-soft">Reste dû : {formatFcfa(lateFee.remaining)}</span>
          {canManage && (
            <Button type="button" variant="warning" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "Fermer" : "Régler"}
            </Button>
          )}
        </div>
      )}

      {open && lateFee.status !== "payee" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <Field label="Montant réglé (FCFA)" htmlFor={`lateFeeAmount-${lateFee.id}`} required hint={`Reste dû : ${formatFcfa(lateFee.remaining)}`}>
            <Input
              id={`lateFeeAmount-${lateFee.id}`}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mode de règlement" htmlFor={`lateFeeMethod-${lateFee.id}`} required>
              <select
                id={`lateFeeMethod-${lateFee.id}`}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Date de règlement" htmlFor={`lateFeePaidAt-${lateFee.id}`} required>
              <Input id={`lateFeePaidAt-${lateFee.id}`} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Note (optionnel)" htmlFor={`lateFeeNotes-${lateFee.id}`}>
            <Input id={`lateFeeNotes-${lateFee.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Enregistrement…" : "Enregistrer le règlement"}
          </Button>
        </form>
      )}
    </div>
  );
}

