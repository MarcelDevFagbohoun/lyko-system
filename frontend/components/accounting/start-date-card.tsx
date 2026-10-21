"use client";

import * as React from "react";
import { CalendarClock, Pencil } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { getAccountingStartDate, setAccountingStartDate, type AccountingStartDate } from "@/lib/api/accounting";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";

/**
 * Date de démarrage de la comptabilité : avant cette date, aucune écriture n'est acceptée, et c'est
 * le mois par lequel commence la clôture. Déplacée de la page Clôture vers Paramètres (étape 54) :
 * c'est un réglage fait une fois, pas une action de clôture.
 */
export function StartDateCard({ accessToken, isDg }: { accessToken: string | null; isDg: boolean }) {
  const [data, setData] = React.useState<AccountingStartDate | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getAccountingStartDate(accessToken)
      .then((res) => {
        setData(res);
        setValue(res.startDate ?? "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la date de démarrage."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  const toast = useToast();

  async function handleSave() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await setAccountingStartDate(accessToken, value || null);
      setEditing(false);
      load();
      toast.success(value ? "Date de démarrage enregistrée." : "Restriction de date retirée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette date.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!data) return null;

  const summary = data.startDate
    ? `Comptabilité active depuis le ${data.startDate}${data.setBy ? `, défini par ${data.setBy.name} (${data.setBy.roleLabel})` : ""}.`
    : "Aucune date de démarrage définie, toutes les dates sont autorisées.";

  if (!isDg) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <CalendarClock size={18} className="text-ink-muted" />
          <p className="text-body-sm text-ink-soft">{summary}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="demarrage-comptabilite">
      <CardHeader>
        <CardTitle>Date de démarrage de la comptabilité</CardTitle>
        <CardDescription>
          Aucune écriture n&apos;est acceptée avant cette date, et la clôture des mois commence par ce mois-là. Utile pour
          ne pas avoir à clôturer les mois antérieurs à votre arrivée sur Africa Immo Management.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        {editing ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Date de démarrage de la comptabilité" htmlFor="accStartDate" hint="Laisser vide pour retirer la restriction">
              <Input id="accStartDate" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
            <Button size="sm" onClick={handleSave} disabled={submitting}>
              {submitting ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setEditing(false); setValue(data.startDate ?? ""); setError(null); }}
              disabled={submitting}
            >
              Annuler
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-body-sm text-ink-soft">
              <CalendarClock size={16} className="text-ink-muted" />
              {summary}
            </p>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Modifier
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
