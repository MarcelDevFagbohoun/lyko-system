"use client";

import type { TenantRhythm } from "@/lib/api/accounting";
import { Field, Input } from "@/components/ui/input";

/**
 * Échéance du loyer à la création d'un bail (étape 2b/5, 2026-10-16) — généralise le champ "Jour
 * d'échéance du loyer" (1-28, calendaire) à un bail créé sous un tenant non-calendaire, qui reçoit
 * à la place un nombre de JOURS APRÈS LE DÉBUT DE LA PÉRIODE (0-27, voir `leases.rent_due_offset_days`
 * côté serveur). `rhythm` absent/non chargé retombe sur le calendaire — comportement identique à
 * avant cette étape, jamais un champ cassé en attendant le chargement.
 */

function isCalendaireRhythm(rhythm: TenantRhythm | null): boolean {
  return !rhythm || rhythm.mode === "calendaire";
}

/** Objet à fusionner dans le payload `createRenter`/`createLease` selon le rythme du tenant. */
export function buildRentDuePayload(
  rhythm: TenantRhythm | null,
  rawValue: string,
): { rentDueDay: number } | { rentDueOffsetDays: number } {
  if (isCalendaireRhythm(rhythm)) return { rentDueDay: Number(rawValue) };
  return { rentDueOffsetDays: Number(rawValue) };
}

/** Message d'erreur si la valeur est hors plage pour le rythme actuel, sinon `null`. */
export function validateRentDue(rhythm: TenantRhythm | null, rawValue: string): string | null {
  const value = Number(rawValue);
  const [min, max] = isCalendaireRhythm(rhythm) ? [1, 28] : [0, 27];
  if (!Number.isInteger(value) || value < min || value > max) return `Jour entre ${min} et ${max}`;
  return null;
}

export function RentDueField({
  rhythm,
  value,
  onChange,
  onBlur,
  error,
}: {
  rhythm: TenantRhythm | null;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
}) {
  const calendaire = isCalendaireRhythm(rhythm);
  return (
    <Field
      label={calendaire ? "Jour d'échéance du loyer" : "Jours après le début de la période"}
      htmlFor="rentDueDay"
      required
      hint={calendaire ? "1 à 28" : "0 à 27 — ex. 10 : loyer dû 10 jours après le début de la période"}
      error={error}
    >
      <Input
        id="rentDueDay"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        onBlur={onBlur}
      />
    </Field>
  );
}
