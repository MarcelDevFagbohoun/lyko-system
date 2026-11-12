"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import {
  OPENING_DEBT_TYPES,
  OPENING_DEBT_TYPE_LABELS,
  OPENING_DEBT_MONTHS_BACK,
  type OpeningDebtType,
} from "@/lib/api/renters";
import { lastNMonths } from "@/lib/dates";
import { monthLabelFr, formatFcfa } from "@/lib/utils";
import type { OpeningDebtItemsState } from "./form-state";

/**
 * Détail des impayés à l'entrée par type + mois (demande utilisateur, 2026-11-12) : remplace le
 * montant unique "Impayés existants à l'entrée" par un sélecteur, pour chaque type (loyer, SBEE,
 * SONEB, poubelle, autres), des 12 derniers mois — un mois sélectionné s'affiche en ROUGE (demande
 * explicite). Le montant du loyer est pré-rempli automatiquement depuis `monthlyRent` à la sélection
 * (reste modifiable), les autres types démarrent à vide (saisie manuelle obligatoire).
 */
export function OpeningDebtItemsFields({
  items,
  setItems,
  monthlyRent,
  error,
}: {
  items: OpeningDebtItemsState;
  setItems: (items: OpeningDebtItemsState) => void;
  monthlyRent: string;
  error?: string;
}) {
  const months = React.useMemo(() => lastNMonths(OPENING_DEBT_MONTHS_BACK), []);
  const totalByType = (type: OpeningDebtType) =>
    Object.values(items[type]).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const grandTotal = OPENING_DEBT_TYPES.reduce((sum, t) => sum + totalByType(t), 0);

  function toggleMonth(type: OpeningDebtType, month: string) {
    const current = items[type];
    const next = { ...current };
    if (month in next) {
      delete next[month];
    } else {
      // Loyer : montant calculé automatiquement à partir du loyer mensuel (reste modifiable juste après).
      next[month] = type === "loyer" ? (monthlyRent || "0") : "";
    }
    setItems({ ...items, [type]: next });
  }

  function setAmount(type: OpeningDebtType, month: string, amount: string) {
    setItems({ ...items, [type]: { ...items[type], [month]: amount.replace(/\D/g, "") } });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-muted p-3.5">
      <div>
        <p className="font-label-sm uppercase tracking-wider text-ink-muted">Impayés existants à l&apos;entrée</p>
        <p className="mt-0.5 text-body-xs text-ink-muted">
          Locataire déjà en place avant Africa Immo Management : cochez, pour chaque type, les mois des{" "}
          {OPENING_DEBT_MONTHS_BACK} derniers mois déjà dus et non payés. Chaque mois coché devient un poste
          réglable séparément.
        </p>
      </div>

      {OPENING_DEBT_TYPES.map((type) => (
        <div key={type} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-label-sm text-ink">{OPENING_DEBT_TYPE_LABELS[type]}</span>
            {totalByType(type) > 0 && (
              <span className="tabular font-currency-table text-body-sm text-danger-fg">
                {formatFcfa(totalByType(type))}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {months.map((month) => {
              const selected = month in items[type];
              return (
                <button
                  key={month}
                  type="button"
                  onClick={() => toggleMonth(type, month)}
                  className={
                    selected
                      ? "rounded-full border border-danger-border bg-danger-bg px-2.5 py-1 text-body-xs font-medium text-danger-fg"
                      : "rounded-full border border-border-strong bg-surface px-2.5 py-1 text-body-xs text-ink-soft hover:border-primary"
                  }
                >
                  {monthLabelFr(month)}
                </button>
              );
            })}
          </div>
          {Object.keys(items[type]).length > 0 && (
            <div className="flex flex-col gap-1.5 pt-1">
              {months
                .filter((m) => m in items[type])
                .map((month) => (
                  <div key={month} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-body-xs font-medium text-danger-fg">{monthLabelFr(month)}</span>
                    <Input
                      inputMode="numeric"
                      value={items[type][month]}
                      onChange={(e) => setAmount(type, month, e.target.value)}
                      placeholder="Montant (FCFA)"
                      className="h-8 text-body-sm"
                    />
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}

      {error && <p className="text-body-sm text-danger-fg">{error}</p>}

      {grandTotal > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span className="text-body-sm text-ink-soft">Total impayés déclarés</span>
          <span className="tabular font-currency-table text-body-md text-danger-fg">{formatFcfa(grandTotal)}</span>
        </div>
      )}
    </div>
  );
}
