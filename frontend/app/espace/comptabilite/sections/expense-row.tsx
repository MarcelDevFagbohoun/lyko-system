"use client";

import * as React from "react";
import {
  Lock,
  FileDown,
  Trash2,
  Pencil,
} from "lucide-react";
import { useCan } from "@/lib/auth/use-can";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  updateExpense,
  deleteExpense,
  paySupplierExpense,
  type Expense,
  type ExpenseCategory,
} from "@/lib/api/accounting";
import type { PaymentMethod } from "@/lib/api/renters";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants/expenses";
import { formatFcfa, formatTimeOfDay } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { TableRow, TableCell, TableAmount } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";
import { todayIso } from "@/lib/dates";
import { CATEGORIES, PAYMENT_METHODS } from "./shared";

export function ExpenseRow({
  expense,
  accessToken,
  locked,
  onChanged,
}: {
  expense: Expense;
  accessToken: string | null;
  locked: boolean;
  onChanged: () => void;
}) {
  const canRecord = useCan("depenses_enregistrer");
  const [editing, setEditing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleteReason, setDeleteReason] = React.useState("");
  const [label, setLabel] = React.useState(expense.label);
  const [amount, setAmount] = React.useState(String(expense.amount));
  const [category, setCategory] = React.useState<ExpenseCategory>(expense.category);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [settling, setSettling] = React.useState(false);
  const [settleMethod, setSettleMethod] = React.useState<PaymentMethod>("especes");
  const [settlePaidAt, setSettlePaidAt] = React.useState(todayIso());
  const toast = useToast();

  async function handleSettle() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await paySupplierExpense(accessToken, expense.id, { paymentMethod: settleMethod, paidAt: settlePaidAt });
      setSettling(false);
      onChanged();
      toast.success(`« ${expense.label} » réglée.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce règlement.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSave() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateExpense(accessToken, expense.id, {
        label: label.trim(),
        amount: Number(amount),
        category,
      });
      setEditing(false);
      onChanged();
      toast.success("Dépense modifiée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!accessToken || deleteReason.trim().length < 5) return;
    setSubmitting(true);
    try {
      await deleteExpense(accessToken, expense.id, deleteReason.trim());
      onChanged();
      toast.info("Dépense supprimée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de supprimer.");
      setSubmitting(false);
      setConfirmDelete(false);
    }
  }

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={8}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Libellé" />
              <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="Montant" />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink"
              >
                {CATEGORIES.map(([key, l]) => (
                  <option key={key} value={key}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={submitting}>Enregistrer</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={submitting}>Annuler</Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (confirmDelete) {
    return (
      <TableRow>
        <TableCell colSpan={8}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <p className="text-body-sm text-ink">
              Supprimer « {expense.label} » ({formatFcfa(expense.amount)}) ? Une justification est obligatoire. La
              suppression restera tracée et visible du DG, mais sortira des totaux.
            </p>
            <Field label="Justification" htmlFor={`delReason-${expense.id}`} required hint="5 caractères minimum">
              <Input
                id={`delReason-${expense.id}`}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Ex. Doublon avec la dépense du..."
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={submitting || deleteReason.trim().length < 5}
              >
                {submitting ? "Suppression…" : "Confirmer la suppression"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setConfirmDelete(false); setDeleteReason(""); }}
                disabled={submitting}
              >
                Annuler
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (settling) {
    return (
      <TableRow>
        <TableCell colSpan={8}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <p className="text-body-sm text-ink">
              Régler « {expense.label} » ({formatFcfa(expense.amount)}) dû à {expense.supplierName} ?
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                value={settleMethod}
                onChange={(e) => setSettleMethod(e.target.value as PaymentMethod)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <Input type="date" value={settlePaidAt} onChange={(e) => setSettlePaidAt(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSettle} disabled={submitting}>
                {submitting ? "Enregistrement…" : "Confirmer le règlement"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSettling(false)} disabled={submitting}>
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
      <TableCell className="text-ink-soft">{formatTimeOfDay(expense.createdAt)}</TableCell>
      <TableCell className="text-ink-soft">{expense.expenseDate}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="text-ink">{expense.label}</span>
          {expense.propertyCode && (
            <Badge variant="info" title="Travaux facturés à ce Bien, à la charge du propriétaire, pas de l'entreprise">
              {expense.propertyCode}
            </Badge>
          )}
        </div>
        {expense.notes && <div className="text-body-xs text-ink-muted">{expense.notes}</div>}
      </TableCell>
      <TableCell className="text-ink-soft">{EXPENSE_CATEGORY_LABELS[expense.category]}</TableCell>
      <TableAmount>{formatFcfa(expense.amount)}</TableAmount>
      <TableCell className="text-ink-soft">
        {expense.paymentStatus === "unpaid" ? (
          <div className="flex items-center gap-1.5">
            <Badge variant="warning">À crédit</Badge>
            <span>{expense.supplierName}</span>
          </div>
        ) : (
          expense.paymentMethodLabel
        )}
      </TableCell>
      <TableCell className="text-ink-soft">
        {expense.recordedBy ? `${expense.recordedBy.name} (${expense.recordedBy.roleLabel})` : "—"}
      </TableCell>
      <TableCell className="text-right">
        {locked ? (
          <Badge variant="neutral">
            <Lock size={11} /> Clôturé
          </Badge>
        ) : !canRecord ? null : (
          <div className="flex items-center justify-end gap-1">
            {expense.paymentStatus === "unpaid" && (
              <Button variant="warning" size="sm" onClick={() => setSettling(true)}>
                Régler
              </Button>
            )}
            {expense.receiptUrl && accessToken && (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Voir le justificatif"
                onClick={() => openAuthenticatedPdf(expense.receiptUrl!, accessToken)}
              >
                <FileDown size={14} />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label="Modifier">
              <Pencil size={14} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label="Supprimer">
              <Trash2 size={14} className="text-danger-fg" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

// Registre des immobilisations du cabinet (matériel propre à l'agence — jamais
// les Biens gérés pour le compte des propriétaires). Contrairement au journal
// des dépenses, ce registre n'est PAS filtré par la période sélectionnée en
// haut de page : une immobilisation vit sur plusieurs années, elle reste donc
// toujours visible en entier, comme le journal des suppressions.
