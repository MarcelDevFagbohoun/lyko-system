"use client";

import { type ExpenseCategory } from "@/lib/api/accounting";
import type { PaymentMethod } from "@/lib/api/renters";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants/expenses";


export const CATEGORIES = Object.entries(EXPENSE_CATEGORY_LABELS) as [ExpenseCategory, string][];
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

export function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

// Toute nouvelle écriture (dépense...) s'ancre sur le mois actuellement
// ouvert (aujourd'hui), jamais sur le mois historique en cours de
// consultation via le sélecteur de période — sinon une dépense créée en
// consultant un ancien mois clôturé se verrait systématiquement refusée.
export function monthRange(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  const from = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

