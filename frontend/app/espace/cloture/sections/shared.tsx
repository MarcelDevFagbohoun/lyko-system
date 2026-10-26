"use client";

import { type AccountingPeriod } from "@/lib/api/accounting";
import { formatDateLabel, monthLabelFr } from "@/lib/utils";


export const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function monthRange(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
}

/** Libellé d'une période clôturée (une ancienne clôture hors mois civil garde sa plage de dates). */
export function closedPeriodLabel(p: AccountingPeriod): string {
  return p.period
    ? capitalize(monthLabelFr(p.period))
    : `Du ${formatDateLabel(p.periodStart)} au ${formatDateLabel(p.periodEnd)}`;
}

