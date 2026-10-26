"use client";

import * as React from "react";
import { TrendingDown, Plus } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  createExpense,
  listSuppliers,
  type ExpenseCategory,
  type Supplier,
} from "@/lib/api/accounting";
import type { PaymentMethod } from "@/lib/api/renters";
import { formatFcfa } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/lib/toast/toast-context";
import { todayIso } from "@/lib/dates";
import { CATEGORIES, PAYMENT_METHODS } from "./shared";

export function ExpenseForm({
  accessToken,
  onCreated,
}: {
  accessToken: string | null;
  onCreated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<ExpenseCategory>("autre");
  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");
  // Toujours ancrée sur aujourd'hui (mois actuellement ouvert), jamais sur
  // le mois historique éventuellement consulté via le sélecteur de période.
  const [expenseDate, setExpenseDate] = React.useState(todayIso());
  const [paymentStatus, setPaymentStatus] = React.useState<"paid" | "unpaid">("paid");
  const [method, setMethod] = React.useState<PaymentMethod>("especes");
  const [supplierName, setSupplierName] = React.useState("");
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [notes, setNotes] = React.useState("");
  const [receipt, setReceipt] = React.useState<File | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Confirmation avant envoi (demande explicite de l'utilisateur, 2026-10-16) — voir `confirm-dialog.tsx`.
  const [confirming, setConfirming] = React.useState(false);
  const toast = useToast();
  const idem = useIdempotencyKey();

  React.useEffect(() => {
    if (!accessToken || !open) return;
    listSuppliers(accessToken).then((res) => setSuppliers(res.suppliers));
  }, [accessToken, open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConfirming(true);
  }

  async function doSubmit() {
    if (!accessToken) return;
    setConfirming(false);
    setSubmitting(true);
    setError(null);
    try {
      await createExpense(accessToken, {
        category,
        label: label.trim(),
        amount: Number(amount),
        expenseDate,
        paymentStatus,
        paymentMethod: paymentStatus === "paid" ? method : undefined,
        supplierName: paymentStatus === "unpaid" ? supplierName.trim() : undefined,
        notes: notes.trim() || undefined,
        receipt: receipt ?? undefined,
        idempotencyKey: idem.key,
      });
      idem.renew();
      setOpen(false);
      setLabel("");
      setAmount("");
      setSupplierName("");
      setNotes("");
      setReceipt(null);
      onCreated();
      toast.success(paymentStatus === "unpaid" ? "Dépense à crédit enregistrée." : "Dépense enregistrée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette dépense.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Nouvelle dépense</span>
        <Button variant="info" size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} />
          {open ? "Fermer" : "Enregistrer une dépense"}
        </Button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Libellé" htmlFor="expLabel" required hint="Ex. Loyer bureau, papeterie...">
              <Input id="expLabel" value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Montant (FCFA)" htmlFor="expAmount" required>
              <Input id="expAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Catégorie" htmlFor="expCategory" required>
              <select
                id="expCategory"
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {CATEGORIES.map(([key, l]) => (
                  <option key={key} value={key}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor="expDate" required>
              <Input id="expDate" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-label-sm text-ink-soft">Règlement</span>
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant={paymentStatus === "paid" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setPaymentStatus("paid")}
              >
                Payée maintenant
              </Button>
              <Button
                type="button"
                variant={paymentStatus === "unpaid" ? "primary" : "secondary"}
                size="sm"
                disabled={category === "salaires"}
                onClick={() => setPaymentStatus("unpaid")}
              >
                À crédit (fournisseur)
              </Button>
            </div>
            {category === "salaires" && paymentStatus === "unpaid" && (
              <p className="text-body-xs text-ink-muted">Un salaire ne peut pas être enregistré à crédit.</p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {paymentStatus === "paid" ? (
              <Field label="Mode de règlement" htmlFor="expMethod" required>
                <select
                  id="expMethod"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Fournisseur" htmlFor="expSupplier" required hint="Nouveau ou déjà connu">
                <Input
                  id="expSupplier"
                  list="expSupplierSuggestions"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                />
                <datalist id="expSupplierSuggestions">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </Field>
            )}
            <Field label="Justificatif (optionnel)" htmlFor="expReceipt" hint="PNG, JPEG, WEBP ou PDF, 5 Mo max">
              <input
                id="expReceipt"
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
                className="text-body-sm text-ink-soft file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:font-label-sm file:text-ink"
              />
            </Field>
          </div>
          <Field label="Note (optionnel)" htmlFor="expNotes">
            <Input id="expNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button
            type="submit"
            disabled={
              submitting ||
              !label.trim() ||
              !amount ||
              (paymentStatus === "unpaid" && (!supplierName.trim() || category === "salaires"))
            }
            className="self-start"
          >
            {submitting ? "Enregistrement…" : "Enregistrer la dépense"}
          </Button>
        </form>
      )}
      <ConfirmDialog
        open={confirming}
        icon={TrendingDown}
        title="Enregistrer cette dépense ?"
        description={
          <>
            <span className="font-label-md text-ink">{formatFcfa(Number(amount) || 0)}</span> —{" "}
            <span className="font-label-md text-ink">{label.trim() || "(sans libellé)"}</span>
            <br />
            {paymentStatus === "paid"
              ? <>Payée maintenant, par {PAYMENT_METHODS.find((m) => m.value === method)?.label.toLowerCase() ?? method}.</>
              : <>À crédit, fournisseur {supplierName.trim() || "(non renseigné)"}.</>}
            {" "}Daté du {new Date(`${expenseDate}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.
          </>
        }
        confirmLabel="Confirmer la dépense"
        confirmVariant="info"
        busy={submitting}
        onConfirm={doSubmit}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

