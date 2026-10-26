"use client";

import * as React from "react";
import { Plus, TrendingUp, Trash2, Lock, FileText } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  listOtherIncomes,
  createOtherIncome,
  deleteOtherIncome,
  type OtherIncome,
  type IncomeCategory,
} from "@/lib/api/accounting";
import { formatFcfa, formatDateHeading } from "@/lib/utils";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { useToast } from "@/lib/toast/toast-context";
import { useCan } from "@/lib/auth/use-can";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";

const CATEGORIES: { value: IncomeCategory; label: string }[] = [
  { value: "prestation", label: "Honoraires / prestation de service" },
  { value: "commission", label: "Commission (apport d'affaires, assurance…)" },
  { value: "interets", label: "Intérêts & produits financiers" },
  { value: "remboursement", label: "Remboursement reçu" },
  { value: "subvention_don", label: "Subvention / don" },
  { value: "autre", label: "Autre entrée" },
];
const METHODS: { value: OtherIncome["paymentMethod"]; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement bancaire" },
  { value: "cheque", label: "Chèque" },
];
const SELECT_CLASS =
  "h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * « Autres entrées » : tout argent encaissé par l'entreprise qui n'est ni un loyer, ni des frais d'agence, ni une
 * commission de vente (honoraires, intérêts, remboursements, subventions…). Compté dans le solde net, la trésorerie
 * et la comptabilité (comptes 706 / 771 / 7588). Jamais reversé à un propriétaire.
 */
export function OtherIncomesCard({
  accessToken,
  from,
  to,
  isClosed,
  onChanged,
}: {
  accessToken: string | null;
  from: string;
  to: string;
  isClosed: boolean;
  onChanged: () => void;
}) {
  const canRecord = useCan("depenses_enregistrer");
  const [incomes, setIncomes] = React.useState<OtherIncome[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await listOtherIncomes(accessToken, { from, to });
      setIncomes(res.incomes);
      setTotal(res.total);
    } catch {
      setIncomes([]);
      setTotal(0);
    }
  }, [accessToken, from, to]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const changed = React.useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  return (
    <Card id="autres-entrees" className="border-success-border bg-success/5">
      <CardHeader>
        <CardTitle>Autres entrées</CardTitle>
        <CardDescription>
          Argent encaissé par l&apos;entreprise hors loyers, frais d&apos;agence et commissions de vente (honoraires, intérêts,
          remboursements, subventions…). Ces entrées s&apos;ajoutent au solde net et à la comptabilité, et ne sont jamais
          reversées à un propriétaire.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isClosed ? (
          <p className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm text-ink-muted">
            <Lock size={14} /> Mois clôturé, aucune nouvelle entrée ne peut être ajoutée.
          </p>
        ) : !canRecord ? null : (
          <div className="flex items-center justify-between">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Nouvelle entrée</span>
            <Button variant="info" size="sm" onClick={() => setOpen((v) => !v)}>
              <Plus size={14} />
              {open ? "Fermer" : "Enregistrer une entrée"}
            </Button>
          </div>
        )}
        {open && !isClosed && (
          <IncomeForm accessToken={accessToken} onCreated={() => { setOpen(false); changed(); }} />
        )}

        {incomes === null ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : incomes.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucune autre entrée enregistrée pour cette période.</p>
        ) : (
          <>
            <p className="text-body-sm text-ink-muted">
              {incomes.length} entrée{incomes.length > 1 ? "s" : ""} · total{" "}
              <span className="font-label-md text-success-fg">{formatFcfa(total)}</span>
            </p>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Date</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>De la part de</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {incomes.map((i) => (
                  <IncomeRow key={i.id} income={i} accessToken={accessToken} locked={isClosed} onChanged={changed} />
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function IncomeForm({ accessToken, onCreated }: { accessToken: string | null; onCreated: () => void }) {
  const [category, setCategory] = React.useState<IncomeCategory>("prestation");
  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [incomeDate, setIncomeDate] = React.useState(todayIso());
  const [method, setMethod] = React.useState<OtherIncome["paymentMethod"]>("especes");
  const [payerName, setPayerName] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [receipt, setReceipt] = React.useState<File | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const idem = useIdempotencyKey();

  async function doSubmit() {
    if (!accessToken) return;
    setConfirming(false);
    setSubmitting(true);
    setError(null);
    try {
      await createOtherIncome(accessToken, {
        category,
        label: label.trim(),
        amount: Number(amount),
        incomeDate,
        paymentMethod: method,
        payerName: payerName.trim() || undefined,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        idempotencyKey: idem.key,
        receipt,
      });
      idem.renew();
      toast.success("Entrée enregistrée.");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette entrée.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setConfirming(true);
        }}
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4"
      >
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Libellé" htmlFor="incLabel" required hint="Ex. Honoraires dossier Dossou, intérêts du compte…">
            <Input id="incLabel" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Montant (FCFA)" htmlFor="incAmount" required>
            <Input id="incAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Catégorie" htmlFor="incCategory" required>
            <select id="incCategory" value={category} onChange={(e) => setCategory(e.target.value as IncomeCategory)} className={SELECT_CLASS}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Date de l'entrée" htmlFor="incDate" required>
            <Input id="incDate" type="date" value={incomeDate} onChange={(e) => setIncomeDate(e.target.value)} />
          </Field>
          <Field label="Reçu par" htmlFor="incMethod" required>
            <select id="incMethod" value={method} onChange={(e) => setMethod(e.target.value as OtherIncome["paymentMethod"])} className={SELECT_CLASS}>
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="De la part de (optionnel)" htmlFor="incPayer">
            <Input id="incPayer" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
          </Field>
          <Field label="Référence (optionnel)" htmlFor="incRef" hint="N° de facture, de virement…">
            <Input id="incRef" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Justificatif (optionnel)" htmlFor="incReceipt" hint="PNG, JPEG, WEBP ou PDF, 5 Mo max">
            <input
              id="incReceipt"
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
              className="text-body-sm text-ink-soft file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:font-label-sm file:text-ink"
            />
          </Field>
        </div>
        <Field label="Note (optionnel)" htmlFor="incNotes">
          <Input id="incNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Button type="submit" disabled={submitting || label.trim().length < 2 || !amount || Number(amount) <= 0} className="self-start">
          {submitting ? "Enregistrement…" : "Enregistrer l'entrée"}
        </Button>
      </form>
      <ConfirmDialog
        open={confirming}
        icon={TrendingUp}
        title="Enregistrer cette entrée ?"
        description={
          <>
            <span className="font-label-md text-ink">{formatFcfa(Number(amount) || 0)}</span> —{" "}
            <span className="font-label-md text-ink">{label.trim() || "(sans libellé)"}</span>
            <br />
            Reçu par {METHODS.find((m) => m.value === method)?.label.toLowerCase()}, daté du{" "}
            {new Date(`${incomeDate}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.
            Elle sera ajoutée à la comptabilité.
          </>
        }
        confirmLabel="Confirmer l'entrée"
        confirmVariant="info"
        busy={submitting}
        onConfirm={doSubmit}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

function IncomeRow({
  income,
  accessToken,
  locked,
  onChanged,
}: {
  income: OtherIncome;
  accessToken: string | null;
  locked: boolean;
  onChanged: () => void;
}) {
  const canRecord = useCan("depenses_enregistrer");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleDelete() {
    if (!accessToken || reason.trim().length < 5) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteOtherIncome(accessToken, income.id, reason.trim());
      toast.info("Entrée supprimée.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de supprimer.");
      setSubmitting(false);
    }
  }

  if (confirmDelete) {
    return (
      <TableRow>
        <TableCell colSpan={7}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <p className="text-body-sm text-ink">
              Supprimer « {income.label} » ({formatFcfa(income.amount)}) ? Une justification est obligatoire. La
              suppression reste tracée, l&apos;écriture comptable est extournée et le montant sort des totaux.
            </p>
            <Field label="Justification" htmlFor={`incDel-${income.id}`} required hint="5 caractères minimum">
              <Input id={`incDel-${income.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex items-center gap-2">
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={submitting || reason.trim().length < 5}>
                {submitting ? "Suppression…" : "Confirmer la suppression"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={submitting}>
                Annuler
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>{formatDateHeading(income.incomeDate)}</TableCell>
      <TableCell>
        <span className="font-label-md text-ink">{income.label}</span>
        {income.reference && <span className="block text-body-xs text-ink-muted">Réf. {income.reference}</span>}
      </TableCell>
      <TableCell>{income.categoryLabel}</TableCell>
      <TableCell>{income.payerName ?? "—"}</TableCell>
      <TableAmount>{formatFcfa(income.amount)}</TableAmount>
      <TableCell>{income.paymentMethodLabel}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {income.receiptUrl && (
            <a href={income.receiptUrl} target="_blank" rel="noreferrer" aria-label="Voir le justificatif" className="rounded p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink">
              <FileText size={14} />
            </a>
          )}
          {!locked && canRecord && (
            <button type="button" aria-label="Supprimer" onClick={() => setConfirmDelete(true)} className="rounded p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger-fg">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
