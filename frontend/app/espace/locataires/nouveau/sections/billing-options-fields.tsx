"use client";

import * as React from "react";
import { Field, Input } from "@/components/ui/input";
import { RENT_TIMING_LABELS, type RentTiming } from "@/lib/api/renters";
import type { FormSectionProps } from "./props";

export function BillingOptionsFields({ form, set, touched, setTouched, errors, isHistoricalStartDate }: FormSectionProps & { isHistoricalStartDate: boolean; }) {
  return (
    <>
          <Field
            label="Convention de paiement"
            htmlFor="rentTiming"
            hint="Réglable par défaut dans Paramètres — à ajuster ici si ce propriétaire a sa propre habitude"
          >
            <select
              id="rentTiming"
              value={form.rentTiming}
              onChange={(e) => {
                set("rentTiming", e.target.value as RentTiming);
                setTouched((t) => ({ ...t, rentTiming: true }));
              }}
              className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {Object.entries(RENT_TIMING_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Impayés existants à l'entrée (FCFA)"
            htmlFor="openingDebtAmount"
            hint="Locataire déjà en place avant Africa Immo Management, avec un impayé connu — 0 si aucun"
            error={touched.openingDebtAmount ? errors.openingDebtAmount : undefined}
          >
            <Input
              id="openingDebtAmount"
              inputMode="numeric"
              value={form.openingDebtAmount}
              onChange={(e) => set("openingDebtAmount", e.target.value.replace(/\D/g, ""))}
              onBlur={() => setTouched((t) => ({ ...t, openingDebtAmount: true }))}
            />
          </Field>
          {isHistoricalStartDate && (
            <label
              htmlFor="upToDateAtOnboarding"
              className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm text-ink"
            >
              <input
                id="upToDateAtOnboarding"
                type="checkbox"
                checked={form.upToDateAtOnboarding}
                onChange={(e) => set("upToDateAtOnboarding", e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Ce locataire est à jour sur son loyer, y compris le mois en cours — évite un faux retard si
                l&apos;échéance de ce mois est déjà passée. (Les mois antérieurs à aujourd&apos;hui ne sont de
                toute façon jamais comptés, même sans cocher cette case.)
              </span>
            </label>
          )}
    </>
  );
}
