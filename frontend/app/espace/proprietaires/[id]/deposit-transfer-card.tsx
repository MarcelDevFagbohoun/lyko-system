"use client";

import * as React from "react";
import { HandCoins, Undo2 } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { createDepositTransfer, type DepositPosition, type DepositTransfer } from "@/lib/api/owners";
import { formatDateLabel, formatFcfa } from "@/lib/utils";
import { useToast } from "@/lib/toast/toast-context";
import { Term } from "@/components/ui/term";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const METHODS = [
  { value: "virement", label: "Virement" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "especes", label: "Espèces" },
  { value: "cheque", label: "Chèque" },
] as const;
const selectCls =
  "h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

type Draft = { position: DepositPosition; direction: "to_owner" | "from_owner" };

/**
 * Cautions remises au propriétaire. Une caution reste DUE au locataire : la remettre au propriétaire (à sa
 * demande, ou pour tout motif justifié) fait sortir l'argent de la caisse sans éteindre cette dette. Elle
 * n'est pas une recette du propriétaire : aucun effet sur son solde, ni sur la commission.
 */
export function DepositTransferCard({
  ownerId,
  ownerName,
  positions,
  withOwnerTotal,
  transfers,
  accessToken,
  canRecord,
  onChanged,
}: {
  ownerId: number;
  ownerName: string;
  positions: DepositPosition[];
  withOwnerTotal: number;
  transfers: DepositTransfer[];
  accessToken: string | null;
  canRecord: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<(typeof METHODS)[number]["value"]>("virement");
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [motive, setMotive] = React.useState("");
  const [byOwner, setByOwner] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Clé d'idempotence (audit du 2026-10-23) : un double-clic ou une relance après timeout
  // n'enregistre plus deux fois le même reversement/la même récupération de caution.
  const idem = useIdempotencyKey();

  if (positions.length === 0 && transfers.length === 0) return null;

  const max = draft ? (draft.direction === "to_owner" ? draft.position.atCabinet : draft.position.withOwner) : 0;
  const open = (position: DepositPosition, direction: Draft["direction"]) => {
    setDraft({ position, direction });
    setAmount(String(direction === "to_owner" ? position.atCabinet : position.withOwner));
    setMotive("");
    setError(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !accessToken) return;
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0 || n > max) return setError(`Montant entre 1 et ${formatFcfa(max)}.`);
    if (motive.trim().length < 5) return setError("Indiquez le motif (5 caractères minimum).");
    setBusy(true);
    setError(null);
    try {
      await createDepositTransfer(accessToken, ownerId, {
        leaseId: draft.position.leaseId,
        depositType: draft.position.type,
        direction: draft.direction,
        amount: n,
        paidAt,
        paymentMethod: method,
        motive: motive.trim(),
        requestedByOwner: draft.direction === "to_owner" ? byOwner : false,
        idempotencyKey: idem.key,
      });
      idem.renew();
      toast.success(draft.direction === "to_owner" ? `${formatFcfa(n)} de caution remis à ${ownerName}.` : `${formatFcfa(n)} récupéré auprès de ${ownerName}.`);
      setDraft(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dépôts de garantie remis au propriétaire</CardTitle>
        <CardDescription>
          Les <Term k="caution">cautions</Term> appartiennent aux locataires : elles doivent leur être restituées à la sortie. Les remettre au propriétaire
          (à sa demande ou pour un motif justifié) n&apos;en fait pas une recette — elles restent à récupérer. Ce point figure dans le bilan du mois.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {withOwnerTotal > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-warning-border bg-warning-bg px-3 py-2.5 text-body-sm text-warning-fg">
            <span>Cautions actuellement détenues par {ownerName}</span>
            <span className="tabular font-currency-table">{formatFcfa(withOwnerTotal)}</span>
          </div>
        )}

        {positions.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Locataire</TableHead>
                <TableHead>Caution</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead className="text-right">Chez l&apos;entreprise</TableHead>
                <TableHead className="text-right">Chez le propriétaire</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((p) => (
                <TableRow key={`${p.leaseId}-${p.type}`}>
                  <TableCell>
                    {p.renterName}
                    <div className="text-body-xs text-ink-muted">{p.propertyCode} · {p.unitCode}</div>
                  </TableCell>
                  <TableCell>{p.typeLabel}</TableCell>
                  <TableCell className="tabular text-right">{formatFcfa(p.amount)}</TableCell>
                  <TableCell className="tabular text-right">{formatFcfa(p.atCabinet)}</TableCell>
                  <TableCell className="tabular text-right">{formatFcfa(p.withOwner)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {canRecord && p.atCabinet > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => open(p, "to_owner")}>
                        <HandCoins size={14} /> Reverser
                      </Button>
                    )}
                    {canRecord && p.withOwner > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => open(p, "from_owner")}>
                        <Undo2 size={14} /> Récupérer
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {draft && (
          <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
            <p className="font-label-md text-ink">
              {draft.direction === "to_owner" ? "Reverser" : "Récupérer"} — {draft.position.typeLabel} de {draft.position.renterName}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Montant (FCFA)" htmlFor="dtAmount" required hint={`Maximum ${formatFcfa(max)}`}>
                <Input id="dtAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Mode de règlement" htmlFor="dtMethod" required>
                <select id="dtMethod" className={selectCls} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Date" htmlFor="dtDate" required>
                <Input id="dtDate" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </Field>
            </div>
            <Field label="Motif (conservé dans l'historique)" htmlFor="dtMotive" required>
              <Input id="dtMotive" value={motive} onChange={(e) => setMotive(e.target.value)} placeholder={draft.direction === "to_owner" ? "Ex. demande du propriétaire du 12/10" : "Ex. sortie du locataire"} />
            </Field>
            {draft.direction === "to_owner" && (
              <label className="flex items-center gap-2 text-body-sm text-ink-soft">
                <input type="checkbox" checked={byOwner} onChange={(e) => setByOwner(e.target.checked)} />
                À la demande du propriétaire
              </label>
            )}
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? "Enregistrement…" : "Confirmer"}</Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Annuler</Button>
            </div>
          </form>
        )}

        {transfers.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Historique</span>
            {transfers.map((t) => (
              <div
                key={t.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-body-sm ${t.direction === "to_owner" ? "border-danger-border bg-danger-bg text-danger-fg" : "border-border"}`}
              >
                <div>
                  <span className={t.direction === "to_owner" ? "text-danger-fg" : "text-ink"}>{t.typeLabel} · {t.renterName}</span>
                  <div className={`text-body-xs ${t.direction === "to_owner" ? "text-danger-fg/80" : "text-ink-muted"}`}>
                    {formatDateLabel(t.paidAt)} · {t.motive}{t.requestedByOwner ? " · à sa demande" : ""}{t.recordedByName ? ` · ${t.recordedByName}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={t.direction === "to_owner" ? "warning" : "success"}>{t.direction === "to_owner" ? "Remis" : "Récupéré"}</Badge>
                  <span className="tabular font-currency-table">{t.direction === "to_owner" ? "− " : ""}{formatFcfa(t.amount)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
