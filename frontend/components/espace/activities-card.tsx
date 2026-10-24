"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

export const MAX_ACTIVITIES = 8;
export const MAX_ACTIVITY_LENGTH = 40;

const SUGGESTIONS = ["Gestion locative", "Transaction immobilière", "Conseil juridique", "Syndic de copropriété", "Expertise foncière", "Décoration"];

/**
 * Activités de l'entreprise : saisies ici, elles s'affichent en liste à puces sous le RCCM et l'IFU, dans l'en-tête
 * des contrats, états des lieux, quittances et autres documents. L'aperçu reprend le rendu du document.
 */
export function ActivitiesCard({
  companyName,
  value,
  onChange,
}: {
  companyName: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function add(raw: string) {
    const text = raw.replace(/\s+/g, " ").trim();
    setError(null);
    if (text.length < 2) return setError("Saisissez au moins 2 caractères.");
    if (text.length > MAX_ACTIVITY_LENGTH) return setError(`${MAX_ACTIVITY_LENGTH} caractères au maximum.`);
    if (value.some((v) => v.toLowerCase() === text.toLowerCase())) return setError("Cette activité existe déjà.");
    if (value.length >= MAX_ACTIVITIES) return setError(`${MAX_ACTIVITIES} activités au maximum.`);
    onChange([...value, text]);
    setDraft("");
  }

  const remaining = SUGGESTIONS.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activités de l&apos;entreprise</CardTitle>
        <CardDescription>
          Listez vos activités : elles apparaissent dans l&apos;en-tête de vos contrats, états des lieux et quittances, juste
          sous le RCCM et l&apos;IFU.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field label="Ajouter une activité" htmlFor="activityDraft" hint={`${value.length}/${MAX_ACTIVITIES} · ${MAX_ACTIVITY_LENGTH} caractères max`}>
          <div className="flex gap-2">
            <Input
              id="activityDraft"
              value={draft}
              maxLength={MAX_ACTIVITY_LENGTH}
              placeholder="ex. Gestion locative"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add(draft);
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={() => add(draft)} disabled={value.length >= MAX_ACTIVITIES}>
              <Plus size={14} /> Ajouter
            </Button>
          </div>
        </Field>
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {value.length < MAX_ACTIVITIES && remaining.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-xs text-ink-muted">Suggestions :</span>
            {remaining.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="rounded-full border border-border bg-surface px-2.5 py-1 text-body-xs text-ink-soft transition-colors hover:border-primary/40 hover:bg-primary-bg hover:text-primary"
              >
                + {s}
              </button>
            ))}
          </div>
        )}

        {value.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Activités enregistrées">
            {value.map((a) => (
              <li key={a} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted py-1 pl-3 pr-1.5 text-body-sm text-ink">
                {a}
                <button
                  type="button"
                  aria-label={`Retirer ${a}`}
                  onClick={() => onChange(value.filter((v) => v !== a))}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-bg hover:text-danger-fg"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Aperçu de l'en-tête : même disposition que sur les documents (puces sur une ligne, retour à la ligne si nombreuses). */}
        <div className="rounded-lg border border-border bg-surface-muted p-4">
          <p className="mb-2 font-label-sm uppercase tracking-wider text-ink-muted">Aperçu dans l&apos;en-tête</p>
          <div className="rounded-md bg-surface p-4 shadow-sm">
            <p className="font-label-md uppercase tracking-wide text-ink">{companyName}</p>
            <p className="text-body-xs text-ink-muted">RCCM … · IFU … · Téléphone</p>
            {value.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-body-xs text-ink-soft">
                {value.map((a) => (
                  <li key={a} className="flex items-center gap-1.5">
                    <span aria-hidden className="h-1 w-1 rounded-full bg-primary" />
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
