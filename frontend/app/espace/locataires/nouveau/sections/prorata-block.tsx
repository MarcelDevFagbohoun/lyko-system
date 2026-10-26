"use client";

import * as React from "react";
import { Field, Input } from "@/components/ui/input";
import { formatFcfa } from "@/lib/utils";
import { DEPOSIT_PAYMENT_METHODS } from "./form-state";
import type { FormSectionProps } from "./props";

export function ProrataBlock({ form, set, touched, setTouched, errors, isCalendaireRhythm, isHistoricalStartDate, prorataPreview }: FormSectionProps & { isCalendaireRhythm: boolean; isHistoricalStartDate: boolean; prorataPreview: { days: number; amount: number; dueDate: string }; }) {
  return (
    <>
          {/* Prorata d'entrée (étape 42) : calendaire uniquement (hypothèse "jour du mois",
              voir rentTracking.js) — pour un bail non-calendaire, ce bloc ne s'affiche pas,
              limitation documentée de l'étape 2. */}
          {isCalendaireRhythm && prorataPreview.days > 0 && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3">
              <p className="text-body-sm text-ink">
                Entrée le <strong>{form.startDate.split("-").reverse().join("/")}</strong>, échéance habituelle le{" "}
                {form.rentDueDay} — {prorataPreview.days} jour{prorataPreview.days > 1 ? "s" : ""} avant le premier cycle
                normal ({prorataPreview.dueDate.split("-").reverse().join("/")}).
              </p>
              <div className="flex flex-col gap-2">
                <label className="flex items-start gap-2.5 text-body-sm text-ink">
                  <input
                    type="radio"
                    name="entryProration"
                    checked={form.entryProration === "aucun"}
                    onChange={() => {
                      set("entryProration", "aucun");
                      setTouched((t) => ({ ...t, entryProration: true }));
                    }}
                    className="mt-0.5"
                  />
                  <span>Ne rien facturer pour ces jours (le premier loyer plein sera dû à la prochaine échéance).</span>
                </label>
                <label className="flex items-start gap-2.5 text-body-sm text-ink">
                  <input
                    type="radio"
                    name="entryProration"
                    checked={form.entryProration === "prorata"}
                    onChange={() => {
                      set("entryProration", "prorata");
                      setTouched((t) => ({ ...t, entryProration: true }));
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    Facturer le prorata d&apos;entrée : <strong>{formatFcfa(prorataPreview.amount)}</strong> pour{" "}
                    {prorataPreview.days} jour{prorataPreview.days > 1 ? "s" : ""} (loyer ÷ 30 × jours) — appartient au
                    propriétaire, ajouté à son compte séquestre.
                  </span>
                </label>
              </div>
              {!isHistoricalStartDate && (
                <label htmlFor="upToDateAtOnboarding" className="flex items-start gap-2.5 text-body-xs text-ink-muted">
                  <input
                    id="upToDateAtOnboarding"
                    type="checkbox"
                    checked={form.upToDateAtOnboarding}
                    onChange={(e) => {
                      set("upToDateAtOnboarding", e.target.checked);
                      setTouched((t) => ({ ...t, upToDateAtOnboarding: true }));
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    Faire démarrer le cycle de loyer normal à la prochaine échéance ({prorataPreview.dueDate.split("-").reverse().join("/")}
                    ) plutôt qu&apos;à celle de ce mois-ci, déjà passée à la date d&apos;entrée — coché par défaut, sinon le
                    bail apparaîtrait à tort en retard dès sa création.
                  </span>
                </label>
              )}
              {form.entryProration === "prorata" && prorataPreview.amount > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label="Prorata reçu par"
                    htmlFor="entryProrataPaymentMethod"
                    required
                    error={touched.entryProrataPaymentMethod ? errors.entryProrataPaymentMethod : undefined}
                  >
                    <select
                      id="entryProrataPaymentMethod"
                      value={form.entryProrataPaymentMethod}
                      onChange={(e) => set("entryProrataPaymentMethod", e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, entryProrataPaymentMethod: true }))}
                      className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <option value="" disabled>
                        Choisir…
                      </option>
                      {DEPOSIT_PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Reçu le" htmlFor="entryProrataPaidAt">
                    <Input
                      id="entryProrataPaidAt"
                      type="date"
                      value={form.entryProrataPaidAt}
                      onChange={(e) => set("entryProrataPaidAt", e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
    </>
  );
}
