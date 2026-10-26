"use client";

import * as React from "react";
import { ShieldCheck, Percent } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { updateCommissionRate, type CommissionRate } from "@/lib/api/owners";
import { formatDateLabel, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";


/**
 * Taux de commission du cabinet sur la recette nette de chaque Bien de ce
 * propriétaire — DG uniquement pour la modification (cahier des charges).
 * Comme pour un versement, un changement de taux est un acte de gérance :
 * un écran de vérification récapitule l'ancien et le nouveau taux avant tout
 * envoi. Aucun taux n'est jamais écrasé, seulement clôturé puis remplacé —
 * l'historique complet reste affiché sous le formulaire.
 */
export function CommissionCard({
  ownerId,
  ownerName,
  isDg,
  activeRate,
  rates,
  accessToken,
  onUpdated,
}: {
  ownerId: number;
  ownerName: string;
  isDg: boolean;
  activeRate: CommissionRate | null;
  rates: CommissionRate[];
  accessToken: string | null;
  onUpdated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<"form" | "confirm">("form");
  const [rate, setRate] = React.useState("");
  const [startsOn, setStartsOn] = React.useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  function reset() {
    setOpen(false);
    setStep("form");
    setError(null);
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0 || n > 100) return setError("Le taux doit être compris entre 0 et 100.");
    if (!startsOn) return setError("Date de début requise.");
    if (activeRate && startsOn <= activeRate.startsOn) {
      return setError(`La date de début doit être postérieure au début du taux actif (${activeRate.startsOn}).`);
    }
    setStep("confirm");
  }

  async function handleConfirm() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateCommissionRate(accessToken, ownerId, { rate: Number(rate), startsOn });
      const newRate = Number(rate);
      reset();
      onUpdated();
      toast.success(`Nouveau taux de commission enregistré : ${newRate} %.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce taux.");
      setStep("form");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commission de l&apos;entreprise</CardTitle>
        <CardDescription>Taux appliqué sur la recette nette de chaque Bien de ce propriétaire.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          {activeRate ? (
            <div>
              <span className="font-display text-headline-md text-ink">{activeRate.rate} %</span>
              <p className="text-body-xs text-ink-muted">En vigueur depuis le {activeRate.startsOn}</p>
            </div>
          ) : (
            <p className="text-body-sm text-warning-fg">
              Aucun taux défini — 0 % appliqué par défaut dans les calculs de recette.
            </p>
          )}
          {isDg && (
            <Button variant="secondary" size="sm" onClick={() => (open ? reset() : setOpen(true))}>
              <Percent size={14} />
              {open ? "Fermer" : activeRate ? "Modifier le taux" : "Définir un taux"}
            </Button>
          )}
        </div>

        {open && error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {open && step === "form" && (
          <form onSubmit={handleReview} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nouveau taux (%)" htmlFor="commissionRate" required hint="Entre 0 et 100">
                <Input
                  id="commissionRate"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </Field>
              <Field
                label="À partir du"
                htmlFor="commissionStartsOn"
                required
                hint="Le taux précédent sera clôturé la veille"
              >
                <Input id="commissionStartsOn" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" className="self-start">
              Vérifier le nouveau taux
            </Button>
          </form>
        )}

        {open && step === "confirm" && (
          <div className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-surface-muted p-4">
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck size={18} />
              <span className="font-label-md">Vérifiez ce changement avant confirmation</span>
            </div>

            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
              <ConfirmRow label="Propriétaire" value={ownerName} strong />
              <ConfirmRow label="Nouveau taux" value={`${rate} %`} strong />
              <ConfirmRow label="En vigueur à partir du" value={formatDateLabel(startsOn)} />
              {activeRate && <ConfirmRow label="Ancien taux (clôturé la veille)" value={`${activeRate.rate} %`} />}
            </div>

            <p className="text-body-xs text-ink-muted">
              L&apos;ancien taux n&apos;est jamais effacé : les recettes déjà calculées pour les mois passés
              resteront basées sur le taux qui était alors en vigueur.
            </p>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("form")} disabled={submitting}>
                Modifier
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={submitting}>
                {submitting ? "Enregistrement…" : "Confirmer le nouveau taux"}
              </Button>
            </div>
          </div>
        )}

        {rates.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Historique des taux</span>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Taux</TableHead>
                  <TableHead>Début</TableHead>
                  <TableHead>Fin</TableHead>
                  <TableHead>Défini par</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {rates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.rate} %</TableCell>
                    <TableCell className="text-ink-soft">{r.startsOn}</TableCell>
                    <TableCell className="text-ink-soft">
                      {r.endsOn ? (
                        r.endsOn
                      ) : r.id === activeRate?.id ? (
                        <Badge variant="success">Actif</Badge>
                      ) : (
                        // Sans date de fin MAIS pas (encore) le taux actif : un taux
                        // programmé pour plus tard (`startsOn` dans le futur) — jamais
                        // "Actif" avant sa date de début (bug réel trouvé 23/09/2026,
                        // voir CommissionCard/routes/owners.js `pickRateValidAt`).
                        <Badge variant="info">Programmé</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-ink-soft">
                      {r.setBy ? `${r.setBy.name} (${r.setBy.roleLabel})` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConfirmRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <span className="text-body-sm text-ink-soft">{label}</span>
      <span className={cn("text-right text-body-sm", strong ? "font-label-md text-ink" : "text-ink")}>{value}</span>
    </div>
  );
}
