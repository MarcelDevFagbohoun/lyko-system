"use client";

import * as React from "react";
import { HandCoins, Lock, ShieldCheck, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { cancelChargeRemittance, createChargeRemittance, type OwnerChargeRemittance } from "@/lib/api/owners";
import type { ChargeAccount } from "@/lib/api/charges";
import { listClosedPeriods } from "@/lib/api/accounting";
import { formatFcfa } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/toast/toast-context";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountLine } from "@/components/charges/utility-point-panel";

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Reversement au propriétaire des charges SONEB/SBEE encaissées (étape 31) :
 * le propriétaire paie la facture mère, le cabinet encaisse chez les
 * locataires puis lui reverse — sans rien garder. Séparé du séquestre des
 * loyers : ni commission ni retenue ne s'appliquent ici.
 */
export function ChargeRemittanceCard({
  ownerId,
  ownerName,
  account,
  remittances,
  accessToken,
  canRecord,
  onChanged,
}: {
  ownerId: number;
  ownerName: string;
  account: ChargeAccount;
  remittances: OwnerChargeRemittance[];
  accessToken: string | null;
  canRecord: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<"form" | "confirm">("form");
  const [amount, setAmount] = React.useState("");
  const [paidAt, setPaidAt] = React.useState(todayIso());
  const [label, setLabel] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const idem = useIdempotencyKey();
  // Mois clôturés : un crédit daté dans l'un d'eux ne peut ni être créé ni annulé (le serveur refuse aussi).
  const [closedPeriods, setClosedPeriods] = React.useState<{ periodStart: string; periodEnd: string }[]>([]);
  React.useEffect(() => {
    if (!accessToken) return;
    listClosedPeriods(accessToken)
      .then((res) => setClosedPeriods(res.periods.map((p) => ({ periodStart: p.periodStart, periodEnd: p.periodEnd }))))
      .catch(() => setClosedPeriods([]));
  }, [accessToken, remittances]);
  const isClosed = (d: string) => closedPeriods.some((p) => d.slice(0, 10) >= p.periodStart && d.slice(0, 10) <= p.periodEnd);

  function openForm() {
    setAmount(account.balance > 0 ? String(account.balance) : "");
    setPaidAt(todayIso());
    setStep("form");
    setError(null);
    setOpen(true);
  }

  function reset() {
    setOpen(false);
    setStep("form");
    setLabel("");
    setNotes("");
    setError(null);
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError("Montant invalide.");
    if (n > account.balance) return setError(`Le montant dépasse les charges disponibles (${formatFcfa(account.balance)}).`);
    if (!paidAt) return setError("Date requise.");
    if (isClosed(paidAt)) return setError("Ce mois est clôturé : choisissez une date dans un mois ouvert.");
    setStep("confirm");
  }

  async function handleConfirm() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const paid = Number(amount);
      const res = await createChargeRemittance(accessToken, ownerId, {
        amount: paid,
        paidAt,
        ...(label.trim() ? { periodLabel: label.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        idempotencyKey: idem.key,
      });
      idem.renew();
      reset();
      onChanged();
      toast.success(`${formatFcfa(paid)} de charges crédités au solde de ${ownerName}.`);
      if (res.accountingNote) toast.warning(res.accountingNote);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créditer ce solde.");
      setStep("form");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HandCoins size={18} className="text-primary" />
          Charges encaissées
        </CardTitle>
        <CardDescription>
          Les charges payées par les locataires restent chez l&apos;entreprise. Créditez-en le solde du propriétaire (en totalité
          ou en partie) : elles seront versées avec le reste de son solde depuis le menu Paiements.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AccountLine account={account} />

        {canRecord && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-label-sm uppercase tracking-wider text-ink-muted">Crédit du solde</span>
              {account.balance > 0 ? (
                <Button variant="success" size="sm" onClick={() => (open ? reset() : openForm())}>
                  <HandCoins size={14} />
                  {open ? "Fermer" : "Créditer le solde"}
                </Button>
              ) : (
                <span className="text-body-xs text-ink-muted">Aucune charge disponible à créditer.</span>
              )}
            </div>

            {open && error && <p className="text-body-sm text-danger-fg">{error}</p>}

            {open && step === "form" && (
              <form onSubmit={handleReview} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Montant (FCFA)" htmlFor="remitAmount" required hint={`Au plus ${formatFcfa(account.balance)}`}>
                    <Input id="remitAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
                  </Field>
                  <Field label="Date du crédit" htmlFor="remitDate" required>
                    <Input id="remitDate" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Libellé (optionnel)" htmlFor="remitLabel" hint="ex. Charges septembre 2026">
                    <Input id="remitLabel" value={label} maxLength={50} onChange={(e) => setLabel(e.target.value)} />
                  </Field>
                </div>
                <Field label="Note (optionnel)" htmlFor="remitNotes">
                  <Input id="remitNotes" value={notes} maxLength={255} onChange={(e) => setNotes(e.target.value)} />
                </Field>
                <Button type="submit" className="self-start">
                  Vérifier le crédit
                </Button>
              </form>
            )}

            {open && step === "confirm" && (
              <div className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-surface-muted p-4">
                <div className="flex items-center gap-2 text-primary">
                  <ShieldCheck size={18} />
                  <span className="font-label-md">Vérifiez ce crédit avant confirmation</span>
                </div>
                <dl className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-body-sm">
                  <ConfirmRow label="Solde crédité" value={ownerName} strong />
                  <ConfirmRow label="Montant" value={formatFcfa(Number(amount))} strong />
                  <ConfirmRow label="Date du crédit" value={paidAt} />
                  {label.trim() && <ConfirmRow label="Libellé" value={label.trim()} />}
                  {notes.trim() && <ConfirmRow label="Note" value={notes.trim()} />}
                </dl>
                <p className="text-body-xs text-ink-muted">
                  Aucun argent ne sort : le solde du propriétaire augmente de ce montant (écriture comptable automatique).
                  Le crédit pourra être annulé, avec justification, tant que ce solde n&apos;a pas été versé.
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep("form")} disabled={submitting}>
                    Modifier
                  </Button>
                  {/* Taille standard : en `sm`, tailwind-merge écrase la couleur de texte du bouton plein (texte sombre sur fond marine). */}
                  <Button onClick={handleConfirm} disabled={submitting}>
                    {submitting ? "Enregistrement…" : `Créditer le solde de ${ownerName}`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {remittances.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucun crédit de charges pour ce propriétaire.</p>
        ) : (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Date</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead>Nature</TableHead>
                <TableHead>Enregistré par</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                {canRecord && <TableHead />}
              </tr>
            </TableHeader>
            <TableBody>
              {remittances.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular text-ink-soft">{r.paidAt}</TableCell>
                  <TableCell>
                    {r.periodLabel || "—"}
                    {r.notes && <span className="block text-body-xs text-ink-muted">{r.notes}</span>}
                  </TableCell>
                  <TableCell className="text-ink-soft">{r.kind === "balance" ? "Crédité au solde" : `Reversé (${r.paymentMethodLabel})`}</TableCell>
                  <TableCell className="text-body-xs text-ink-muted">
                    {r.recordedBy?.name ?? "—"}
                    <span className="block">le {r.createdAt.slice(0, 10)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular font-currency-table">{formatFcfa(r.amount)}</TableCell>
                  {canRecord && (
                    <TableCell className="text-right">
                      {isClosed(r.paidAt) ? (
                        <Badge variant="neutral">
                          <Lock size={11} /> Clôturé
                        </Badge>
                      ) : (
                      <CancelRemittance ownerId={ownerId} remittance={r} accessToken={accessToken} onCancelled={onChanged} />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ConfirmRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={strong ? "font-label-md text-ink" : "text-ink"}>{value}</dd>
    </div>
  );
}

/** Annulation d'un crédit : justification obligatoire, la trace reste (suppression logique). */
function CancelRemittance({
  ownerId,
  remittance,
  accessToken,
  onCancelled,
}: {
  ownerId: number;
  remittance: OwnerChargeRemittance;
  accessToken: string | null;
  onCancelled: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleCancel() {
    if (!accessToken) return;
    if (reason.trim().length < 5) return setError("Justification requise (5 caractères minimum).");
    setBusy(true);
    setError(null);
    try {
      await cancelChargeRemittance(accessToken, ownerId, remittance.id, reason.trim());
      toast.info(`Crédit de ${formatFcfa(remittance.amount)} annulé.`);
      onCancelled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Annulation impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="text-danger-fg" onClick={() => setOpen(true)}>
        <X size={14} />
        Annuler
      </Button>
    );
  }
  return (
    <div className="flex min-w-[15rem] flex-col items-end gap-1.5">
      <input
        value={reason}
        maxLength={255}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Justification (obligatoire)"
        aria-label="Justification de l'annulation"
        className="h-8 w-full rounded border border-border-strong bg-surface px-2 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      {error && <p className="text-body-xs text-danger-fg">{error}</p>}
      <div className="flex gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
          Retour
        </Button>
        <Button variant="danger" size="sm" onClick={handleCancel} disabled={busy}>
          {busy ? "…" : "Annuler le crédit"}
        </Button>
      </div>
    </div>
  );
}
