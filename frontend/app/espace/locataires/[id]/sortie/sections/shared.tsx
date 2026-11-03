"use client";

import type { ReviewHistoryEntry } from "@/lib/api/renters";
import { formatFcfa } from "@/lib/utils";

export const REFUND_PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

const HISTORY_LABELS: Record<ReviewHistoryEntry["type"], string> = {
  submitted: "Soumis pour validation",
  edited: "Modifié après soumission",
  rejected: "Rejeté",
  validated: "Validé",
  tenant_paid: "Caution restituée au locataire",
  balance_collected: "Complément encaissé du locataire",
  repair_fee_charged: "Frais de réparation prélevés",
};

/**
 * Historique visible du circuit de validation/décaissement (demande utilisateur, 2026-11-03) — journal
 * en ajout seul (`reviewHistory`), partagé entre le brouillon (soumission/rejet/validation) et la fiche
 * finalisée (décaissement/encaissement/frais de réparation, qui arrivent après coup).
 */
export function ReviewHistoryList({ history }: { history: ReviewHistoryEntry[] }) {
  if (!history || history.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">Historique de validation</span>
      <ul className="flex flex-col gap-1.5">
        {history
          .slice()
          .reverse()
          .map((h, i) => (
            <li key={i} className="text-body-xs text-ink-muted">
              <span className="font-label-sm text-ink">{HISTORY_LABELS[h.type] ?? h.type}</span>
              {h.by?.name ? ` — ${h.by.name}` : ""} · {new Date(h.at).toLocaleString("fr-FR")}
              {h.note ? ` : « ${h.note} »` : ""}
              {h.amount ? ` (${formatFcfa(h.amount)})` : ""}
              {h.changedFields && h.changedFields.length > 0 ? ` (${h.changedFields.join(", ")})` : ""}
            </li>
          ))}
      </ul>
    </div>
  );
}

