"use client";

import * as React from "react";
import { Field, Input } from "@/components/ui/input";
import type { FormSectionProps } from "./props";

export function IdentityFields({ form, set, touched, setTouched, errors }: FormSectionProps) {
  return (
    <>
          <div className="flex flex-col gap-4 border-t border-border pt-5">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Identité</span>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Prénom" htmlFor="firstName" required error={touched.firstName ? errors.firstName : undefined}>
                <Input id="firstName" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, firstName: true }))} />
              </Field>
              <Field label="Nom" htmlFor="lastName" required error={touched.lastName ? errors.lastName : undefined}>
                <Input id="lastName" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, lastName: true }))} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Numéro de téléphone" htmlFor="phone" required hint="Ex. 0161234567" error={touched.phone ? errors.phone : undefined}>
                <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, phone: true }))} inputMode="tel" />
              </Field>
              <Field label="Email (optionnel)" htmlFor="email" error={touched.email ? errors.email : undefined}>
                <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))} />
              </Field>
            </div>
            <Field label="Profession (optionnel)" htmlFor="profession">
              <Input id="profession" value={form.profession} onChange={(e) => set("profession", e.target.value)} />
            </Field>
          </div>
    </>
  );
}
