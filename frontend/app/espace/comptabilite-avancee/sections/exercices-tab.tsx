"use client";

import * as React from "react";
import { Plus, Lock } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  createGlFiscalYear,
  closeGlFiscalYear,
  getClosingPreview,
  type GlFiscalYear,
} from "@/lib/api/gl";
import { formatFcfa, formatDateLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";


export function ExercicesTab({
  accessToken,
  fiscalYears,
  onChanged,
}: {
  accessToken: string | null;
  fiscalYears: GlFiscalYear[];
  onChanged: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [closingId, setClosingId] = React.useState<number | null>(null);
  const toast = useToast();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await createGlFiscalYear(accessToken, { label: label.trim(), startDate, endDate });
      toast.success("Exercice ouvert.");
      setOpen(false);
      setLabel("");
      setStartDate("");
      setEndDate("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ouvrir cet exercice.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClose(fy: GlFiscalYear) {
    if (!accessToken) return;
    let detail = "";
    try {
      const pv = await getClosingPreview(accessToken, fy.id);
      if (pv.mode === "complet") {
        detail = `\n\nRésultat de l'exercice : ${formatFcfa(Math.abs(pv.resultat))} (${pv.resultat >= 0 ? "bénéfice" : "perte"}). Il sera enregistré dans vos capitaux propres (compte ${pv.destinationAccount}) et reporté sur l'exercice suivant.`;
      }
    } catch {
      detail = "";
    }
    const ok = window.confirm(
      `Clôturer définitivement l'exercice ${fy.label} ? Cette action est irréversible : plus aucune écriture ne pourra y être ajoutée.${detail}`,
    );
    if (!ok) return;
    setClosingId(fy.id);
    try {
      await closeGlFiscalYear(accessToken, fy.id);
      toast.success(`Exercice ${fy.label} clôturé.`);
      onChanged();
    } catch (err) {
      toast.info(err instanceof ApiError ? err.message : "Impossible de clôturer cet exercice.");
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Exercices comptables</span>
        <Button variant="info" size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} />
          {open ? "Fermer" : "Ouvrir un exercice"}
        </Button>
      </div>

      {open && (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Libellé" htmlFor="fyLabel" required hint="Ex. 2027">
              <Input id="fyLabel" value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Début" htmlFor="fyStart" required>
              <Input id="fyStart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Fin" htmlFor="fyEnd" required>
              <Input id="fyEnd" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={submitting || !label.trim() || !startDate || !endDate} className="self-start">
            {submitting ? "Ouverture…" : "Ouvrir l'exercice"}
          </Button>
        </form>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Libellé</TableHead>
            <TableHead>Période</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {fiscalYears.map((fy) => (
            <TableRow key={fy.id}>
              <TableCell>{fy.label}</TableCell>
              <TableCell>
                {formatDateLabel(fy.startDate)} → {formatDateLabel(fy.endDate)}
              </TableCell>
              <TableCell>
                <Badge variant={fy.status === "ouvert" ? "success" : "neutral"}>
                  {fy.status === "ouvert" ? "Ouvert" : "Clôturé"}
                </Badge>
              </TableCell>
              <TableCell>
                {fy.status === "ouvert" && (
                  <Button variant="danger" size="sm" disabled={closingId === fy.id} onClick={() => handleClose(fy)}>
                    <Lock size={14} />
                    {closingId === fy.id ? "Clôture…" : "Clôturer"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Rapprochement bancaire ─────────────────────────────────────────────────
// Compare le solde comptable du compte banque (521, seul compte banque de ce
// système) avec un relevé bancaire saisi manuellement (aucune intégration
// bancaire réelle). Maître-détail dans le même onglet : la liste des
// rapprochements passés, et le détail de celui sélectionné en dessous.

