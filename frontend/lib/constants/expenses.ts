import type { ExpenseCategory } from "@/lib/api/accounting";

/** Miroir de backend/src/constants/expenses.js pour l'affichage côté client. */
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  loyer_bureau: "Loyer du bureau",
  salaires: "Salaires & charges sociales",
  fournitures: "Fournitures & équipement",
  entretien: "Entretien & réparations",
  transport: "Transport & déplacements",
  communication: "Communication (téléphone, internet)",
  marketing: "Marketing & publicité",
  taxes: "Taxes & redevances",
  autre: "Autre",
};
