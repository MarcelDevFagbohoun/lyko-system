"use client";

import * as React from "react";
import { Field, Input } from "@/components/ui/input";
import { type AdditionalDepositType } from "@/lib/api/renters";
import { DEPOSIT_PAYMENT_METHODS, ADDITIONAL_DEPOSIT_TYPES, type FormState } from "./form-state";

export function AdditionalDepositsBlock({ form, enabledTypes, touchedByType, setTouchedByType, errorsByType, setAdditionalDeposit }: { form: FormState; enabledTypes: typeof ADDITIONAL_DEPOSIT_TYPES; touchedByType: Partial<Record<AdditionalDepositType, boolean>>; setTouchedByType: React.Dispatch<React.SetStateAction<Partial<Record<AdditionalDepositType, boolean>>>>; errorsByType: Partial<Record<AdditionalDepositType, string>>; setAdditionalDeposit: (type: AdditionalDepositType, patch: Partial<{ amount: string; paymentMethod: string; paidAt: string }>) => void; }) {
  return (
    <>
          {enabledTypes.length > 0 && (
            <div className="flex flex-col gap-4 rounded-lg border border-border-subtle p-4">
              <p className="font-label-md text-ink">Cautions supplémentaires</p>
              {enabledTypes.map((t) => {
                const entry = form.additionalDeposits[t.key];
                const amountId = `additionalDeposit-${t.key}-amount`;
                const methodId = `additionalDeposit-${t.key}-method`;
                const paidAtId = `additionalDeposit-${t.key}-paidAt`;
                return (
                  <div key={t.key} className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field
                        label={`${t.label} (FCFA)`}
                        htmlFor={amountId}
                        hint="0 si non demandée à ce locataire"
                        error={touchedByType[t.key] ? errorsByType[t.key] : undefined}
                      >
                        <Input
                          id={amountId}
                          inputMode="numeric"
                          value={entry.amount}
                          onChange={(e) => setAdditionalDeposit(t.key, { amount: e.target.value.replace(/\D/g, "") })}
                          onBlur={() => setTouchedByType((tt) => ({ ...tt, [t.key]: true }))}
                        />
                      </Field>
                    </div>
                    {Number(entry.amount || "0") > 0 && (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Reçue par" htmlFor={methodId} required>
                          <select
                            id={methodId}
                            value={entry.paymentMethod}
                            onChange={(e) => setAdditionalDeposit(t.key, { paymentMethod: e.target.value })}
                            onBlur={() => setTouchedByType((tt) => ({ ...tt, [t.key]: true }))}
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
                        <Field label="Reçue le" htmlFor={paidAtId}>
                          <Input
                            id={paidAtId}
                            type="date"
                            value={entry.paidAt}
                            onChange={(e) => setAdditionalDeposit(t.key, { paidAt: e.target.value })}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
    </>
  );
}
