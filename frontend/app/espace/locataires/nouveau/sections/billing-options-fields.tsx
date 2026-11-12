"use client";

import * as React from "react";
import { Field } from "@/components/ui/input";
import { RENT_TIMING_LABELS, type RentTiming } from "@/lib/api/renters";
import type { FormSectionProps } from "./props";
import { OpeningDebtItemsFields } from "./opening-debt-items-fields";

export function BillingOptionsFields({ form, set, touched, setTouched, errors, isHistoricalStartDate, hasLoyerOpeningDebt }: FormSectionProps & { isHistoricalStartDate: boolean; hasLoyerOpeningDebt: boolean; }) {
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
          {/* Impayés à l'entrée : sans objet pour un NOUVEAU locataire qui signe aujourd'hui — aucun
              impayé antérieur ne peut exister. Réservé à l'onboarding d'un ancien locataire déjà en
              place (demande utilisateur, 2026-11-12). */}
          {isHistoricalStartDate && (
            <OpeningDebtItemsFields
              items={form.openingDebtItems}
              setItems={(items) => set("openingDebtItems", items)}
              monthlyRent={form.monthlyRent}
              error={touched.openingDebtItems ? errors.openingDebtItems : undefined}
            />
          )}
          {/* Contradictoire avec un loyer impayé déclaré ci-dessus : décochée et non cochable dans ce
              cas (demande utilisateur, 2026-11-12) — l'auto-décochage est géré dans use-new-renter-form.ts. */}
          {isHistoricalStartDate && hasLoyerOpeningDebt && (
            <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-xs text-ink-muted">
              Un loyer impayé est déclaré ci-dessus : ce locataire n&apos;est donc pas à jour sur son loyer.
            </p>
          )}
          {isHistoricalStartDate && !hasLoyerOpeningDebt && (
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
