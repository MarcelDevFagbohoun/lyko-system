"use client";

import * as React from "react";
import { Field, Input } from "@/components/ui/input";
import { RentDueField } from "@/components/renters/rent-due-field";
import type { TenantRhythm } from "@/lib/api/accounting";
import { DEPOSIT_PAYMENT_METHODS } from "./form-state";
import type { FormSectionProps } from "./props";

export function LeaseTermsFields({ form, set, touched, setTouched, errors, rhythm }: FormSectionProps & { rhythm: TenantRhythm | null; }) {
  return (
    <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Loyer mensuel (FCFA)" htmlFor="monthlyRent" required hint="Pré-rempli depuis l'unité, modifiable" error={touched.monthlyRent ? errors.monthlyRent : undefined}>
              <Input id="monthlyRent" inputMode="numeric" value={form.monthlyRent} onChange={(e) => set("monthlyRent", e.target.value.replace(/\D/g, ""))} onBlur={() => setTouched((t) => ({ ...t, monthlyRent: true }))} />
            </Field>
            <Field label="Caution (FCFA)" htmlFor="depositAmount" hint="0 si aucune" error={touched.depositAmount ? errors.depositAmount : undefined}>
              <Input id="depositAmount" inputMode="numeric" value={form.depositAmount} onChange={(e) => set("depositAmount", e.target.value.replace(/\D/g, ""))} onBlur={() => setTouched((t) => ({ ...t, depositAmount: true }))} />
            </Field>
          </div>
          {Number(form.depositAmount || "0") > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Caution reçue par"
                htmlFor="depositPaymentMethod"
                required
                error={touched.depositPaymentMethod ? errors.depositPaymentMethod : undefined}
              >
                <select
                  id="depositPaymentMethod"
                  value={form.depositPaymentMethod}
                  onChange={(e) => set("depositPaymentMethod", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, depositPaymentMethod: true }))}
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
              <Field label="Reçue le" htmlFor="depositPaidAt">
                <Input
                  id="depositPaidAt"
                  type="date"
                  value={form.depositPaidAt}
                  onChange={(e) => set("depositPaidAt", e.target.value)}
                />
              </Field>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Frais d'agence à l'entrée (FCFA)"
              htmlFor="entryFeeAmount"
              hint="Pris directement au locataire, jamais reversé au propriétaire — 0 si aucun"
              error={touched.entryFeeAmount ? errors.entryFeeAmount : undefined}
            >
              <Input
                id="entryFeeAmount"
                inputMode="numeric"
                value={form.entryFeeAmount}
                onChange={(e) => set("entryFeeAmount", e.target.value.replace(/\D/g, ""))}
                onBlur={() => setTouched((t) => ({ ...t, entryFeeAmount: true }))}
              />
            </Field>
          </div>
          {Number(form.entryFeeAmount || "0") > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Frais d'agence reçus par"
                htmlFor="entryFeePaymentMethod"
                required
                error={touched.entryFeePaymentMethod ? errors.entryFeePaymentMethod : undefined}
              >
                <select
                  id="entryFeePaymentMethod"
                  value={form.entryFeePaymentMethod}
                  onChange={(e) => set("entryFeePaymentMethod", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, entryFeePaymentMethod: true }))}
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
              <Field label="Reçus le" htmlFor="entryFeePaidAt">
                <Input
                  id="entryFeePaidAt"
                  type="date"
                  value={form.entryFeePaidAt}
                  onChange={(e) => set("entryFeePaidAt", e.target.value)}
                />
              </Field>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RentDueField
              rhythm={rhythm}
              value={form.rentDueDay}
              onChange={(v) => set("rentDueDay", v)}
              onBlur={() => setTouched((t) => ({ ...t, rentDueDay: true }))}
              error={touched.rentDueDay ? errors.rentDueDay : undefined}
            />
            <Field label="Date d'entrée" htmlFor="startDate" required error={touched.startDate ? errors.startDate : undefined}>
              <Input id="startDate" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, startDate: true }))} />
            </Field>
          </div>
    </>
  );
}
