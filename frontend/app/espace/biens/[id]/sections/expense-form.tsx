"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import { type Unit } from "@/lib/api/properties";
import { createExpense, type ExpenseCategory } from "@/lib/api/accounting";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants/expenses";
import type { PaymentMethod } from "@/lib/api/renters";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/lib/toast/toast-context";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { EXPENSE_PAYMENT_METHODS } from "./recette-card";

/**
 * Saisie d'une dépense rattachée à ce Bien — et, si une Unité précise est
 * choisie, à cette Unité (ex. réparation d'une seule chambre). `propertyId`
 * est fixé par le contexte (fiche du Bien) : pas de sélecteur à ce niveau,
 * contrairement au formulaire général de Comptabilité.
 */
export function NewPropertyExpenseForm({
  propertyId,
  units,
  accessToken,
  onRecorded,
}: {
  propertyId: number;
  units: Unit[];
  accessToken: string | null;
  onRecorded: () => void;
}) {
  const [category, setCategory] = React.useState<ExpenseCategory>("entretien");
  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [expenseDate, setExpenseDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = React.useState<PaymentMethod>("especes");
  const [unitId, setUnitId] = React.useState<string>(""); // "" = tout le Bien
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const idem = useIdempotencyKey();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (!label.trim()) return setError("Libellé requis.");
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError("Montant invalide.");
    setSubmitting(true);
    setError(null);
    try {
      await createExpense(accessToken, {
        category,
        label: label.trim(),
        amount: n,
        expenseDate,
        paymentMethod: method,
        notes: notes.trim() || undefined,
        propertyId,
        unitId: unitId ? Number(unitId) : undefined,
        idempotencyKey: idem.key,
      });
      idem.renew();
      onRecorded();
      toast.success("Dépense enregistrée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette dépense.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Libellé" htmlFor="propExpLabel" required hint="Ex. Réparation robinetterie">
          <Input id="propExpLabel" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Montant (FCFA)" htmlFor="propExpAmount" required>
          <Input id="propExpAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Unité concernée (optionnel)" htmlFor="propExpUnit" hint="Laisser vide si ça concerne tout le Bien">
          <select
            id="propExpUnit"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">Tout le Bien</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.code}</option>
            ))}
          </select>
        </Field>
        <Field label="Catégorie" htmlFor="propExpCategory" required>
          <select
            id="propExpCategory"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {Object.entries(EXPENSE_CATEGORY_LABELS).map(([key, l]) => (
              <option key={key} value={key}>{l}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" htmlFor="propExpDate" required>
          <Input id="propExpDate" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
        </Field>
        <Field label="Mode de règlement" htmlFor="propExpMethod" required>
          <select
            id="propExpMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {EXPENSE_PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Note (optionnel)" htmlFor="propExpNotes">
        <Input id="propExpNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Button type="submit" disabled={submitting} className="self-start">
        {submitting ? "Enregistrement…" : "Enregistrer la dépense"}
      </Button>
    </form>
  );
}

/**
 * Repère GPS du Bien (étape 13, idée n°10 : carte du portefeuille) — placé à
 * la main sur une carte (jamais géocodé depuis l'adresse texte libre, trop
 * imprécise au Bénin). Permet de retrouver ce Bien sur « Nos biens » → Carte.
 */
