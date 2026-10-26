"use client";

import * as React from "react";
import {
  FileText,
  Send,
  Receipt,
  Lock,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  createPayment,
  receiptPdfPath,
  generateReceiptShareLink,
  receiptShareUrl,
  type Lease,
  type PaymentMethod,
} from "@/lib/api/renters";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import {
  formatFcfa,
  buildReceiptMessage,
  previewRentAllocation,
  monthLabelFr,
  newIdempotencyKey,
} from "@/lib/utils";
import { useToast } from "@/lib/toast/toast-context";
import { DocumentDownloadStatus } from "@/components/documents/document-download-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import {
  MonthGroupsToolbar,
  MonthHeaderRow,
  countLabel,
  useMonthGroups,
} from "@/components/ui/month-group";
import { sumBy } from "@/lib/group-by-month";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
} from "@/components/ui/table";
import { leasePaymentMonth } from "./balance-snapshots-section";
import { PAYMENT_METHODS } from "./opening-debt-section";

export function PaymentRegister({
  lease,
  renterFirstName,
  renterPhone,
  accessToken,
  canManage,
  canRecord,
  isDg,
  onRecorded,
}: {
  lease: Lease;
  renterFirstName: string;
  renterPhone: string;
  accessToken: string | null;
  // Enregistrer un paiement / télécharger une quittance : réservé à
  // locataires OU comptabilite côté serveur — la fiche est désormais
  // consultable par tout employé, mais pas ces actions financières.
  canManage: boolean;
  // Enregistrer un paiement : permission « loyers_encaisser » (consulter l'historique ne suffit pas).
  canRecord: boolean;
  isDg: boolean;
  onRecorded: () => void;
}) {
  const { tenant } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState(String(lease.monthlyRent));
  const [method, setMethod] = React.useState<PaymentMethod>("mobile_money");
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Confirmation avant envoi (demande explicite de l'utilisateur, 2026-10-16) : le bouton « Enregistrer
  // le paiement » ouvre ce récapitulatif plutôt que d'envoyer directement — voir `components/ui/confirm-dialog.tsx`.
  const [confirming, setConfirming] = React.useState(false);
  // Clé d'idempotence de l'envoi en cours : renouvelée après chaque paiement enregistré, conservée si
  // l'envoi échoue (réessayer avec la même clé est sans risque : une clé n'est consommée que si le
  // paiement est enregistré). Deux paiements voulus ont donc toujours deux clés différentes.
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => newIdempotencyKey());
  // Quittance générée par le dernier paiement, prête à envoyer par WhatsApp —
  // le lien de partage est demandé automatiquement dès l'enregistrement
  // réussi, sans action supplémentaire du personnel.
  const [justPaid, setJustPaid] = React.useState<{ paymentId: number; coversMonth: string; amount: number; shareUrl: string | null } | null>(null);
  const toast = useToast();
  const paymentGroups = useMonthGroups(lease.payments, leasePaymentMonth);

  // Mois de départ = prochain mois dû (le serveur enchaîne les mois suivants selon le montant).
  const startMonth = lease.arrears?.nextDueMonth ?? new Date().toISOString().slice(0, 7);
  // Un mois déjà entamé (paiement partiel) se COMPLÈTE d'abord : on propose donc le reste, pas un loyer entier.
  const alreadyPaid = lease.arrears?.paidForNextDueMonth ?? 0;
  const partialRemaining = alreadyPaid > 0 ? Math.max(0, lease.monthlyRent - alreadyPaid) : 0;
  const alloc = previewRentAllocation(startMonth, lease.monthlyRent, Number(amount) || 0, alreadyPaid);

  function openPaymentForm(defaultAmount: number) {
    setAmount(String(defaultAmount));
    setError(null);
    setOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConfirming(true);
  }

  async function doSubmit() {
    if (!accessToken) return;
    setConfirming(false);
    setSubmitting(true);
    setError(null);
    try {
      const result = await createPayment(accessToken, lease.id, {
        amount: Number(amount),
        paymentMethod: method,
        paidAt,
        notes: notes.trim() || undefined,
        idempotencyKey,
      });
      setIdempotencyKey(newIdempotencyKey());
      setOpen(false);
      setNotes("");
      if (result.queued) {
        toast.warning(
          "Paiement enregistré hors-ligne — sera synchronisé automatiquement dès le retour de la connexion.",
        );
      } else {
        if (result.monthsCovered > 1) {
          toast.success(`${result.monthsCovered} paiements enregistrés — ${result.monthsCovered} quittances générées.`);
        } else {
          toast.success("Paiement enregistré — quittance générée.");
        }
        // Quittance prête à envoyer immédiatement, sans que le personnel
        // n'ait à aller la chercher dans l'historique — le lien de partage
        // est demandé tout de suite (idempotent côté serveur).
        const first = result.payments[0];
        setJustPaid({ paymentId: first.paymentId, coversMonth: first.coversMonth, amount: Number(amount), shareUrl: null });
        generateReceiptShareLink(accessToken, lease.id, first.paymentId)
          .then((r) =>
            setJustPaid((prev) => (prev?.paymentId === first.paymentId ? { ...prev, shareUrl: receiptShareUrl(r.token) } : prev)),
          )
          .catch(() => {
            // Best-effort : le paiement est déjà enregistré avec succès, un
            // échec ici ne doit jamais faire croire à un échec du paiement.
          });
      }
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer le paiement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Registre des paiements</span>
        {canRecord && (
          <Button
            variant="success"
            size="sm"
            onClick={() => (open ? setOpen(false) : openPaymentForm(partialRemaining > 0 ? partialRemaining : lease.monthlyRent))}
          >
            <Receipt size={14} />
            {open ? "Fermer" : "Enregistrer un paiement"}
          </Button>
        )}
      </div>

      {partialRemaining > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-border bg-warning-bg px-4 py-3">
          <p className="text-body-sm text-warning-fg">
            <span className="font-label-md capitalize">{monthLabelFr(startMonth)}</span> n&apos;est payé qu&apos;en partie :{" "}
            {formatFcfa(alreadyPaid)} sur {formatFcfa(lease.monthlyRent)} — il reste{" "}
            <span className="font-label-md">{formatFcfa(partialRemaining)}</span>.
          </p>
          {canRecord && !open && (
            <Button variant="success" onClick={() => openPaymentForm(partialRemaining)}>
              <Receipt size={14} />
              Payer le reste ({formatFcfa(partialRemaining)})
            </Button>
          )}
        </div>
      )}

      {justPaid && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success-border bg-success-bg px-4 py-3">
          <p className="text-body-sm text-success-fg">
            Quittance générée — prête à envoyer à {renterFirstName}.
          </p>
          <div className="flex items-center gap-2">
            {justPaid.shareUrl ? (
              <a
                href={buildWhatsAppHref(
                  renterPhone,
                  buildReceiptMessage({
                    renterFirstName,
                    coversMonth: justPaid.coversMonth,
                    amount: justPaid.amount,
                    url: justPaid.shareUrl,
                    companyName: tenant?.companyName,
                  }),
                )}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "whatsapp", size: "sm" })}
              >
                <Send size={14} />
                Envoyer la quittance par WhatsApp
              </a>
            ) : (
              <span className="text-body-xs text-ink-muted">Préparation du lien…</span>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setJustPaid(null)}>
              Fermer
            </Button>
          </div>
        </div>
      )}

      {open && canRecord && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <Field
            label="Montant reçu (FCFA)"
            htmlFor="amount"
            required
            hint={
              partialRemaining > 0
                ? `Reste à payer pour ${monthLabelFr(startMonth)} : ${formatFcfa(partialRemaining)}. Au-delà, l'excédent couvre les mois suivants.`
                : `Loyer mensuel : ${formatFcfa(lease.monthlyRent)}. Saisissez plusieurs mois d'un coup, ex. ${formatFcfa(lease.monthlyRent * 3)} = 3 mois.`
            }
          >
            <Input id="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
          </Field>

          {Number(amount) > 0 && alloc.monthsCovered > 0 && (
            <div className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-body-sm text-ink-soft">
              {alloc.monthsCovered === 1 && alloc.items[0].completes && (
                <>
                  Solde <span className="font-label-md text-ink">{monthLabelFr(alloc.items[0].coversMonth)}</span> :{" "}
                  {formatFcfa(alloc.items[0].amount)} qui complètent les {formatFcfa(alreadyPaid)} déjà payés — le mois sera
                  entièrement réglé. 1 quittance.
                </>
              )}
              {alloc.monthsCovered === 1 && !alloc.items[0].isPartial && !alloc.items[0].completes && (
                <>Couvre <span className="font-label-md text-ink">{monthLabelFr(alloc.items[0].coversMonth)}</span> — 1 quittance.</>
              )}
              {alloc.monthsCovered === 1 && alloc.items[0].isPartial && (
                <>
                  Paiement partiel de <span className="font-label-md text-ink">{formatFcfa(alloc.items[0].amount)}</span> sur{" "}
                  {monthLabelFr(alloc.items[0].coversMonth)} — il restera{" "}
                  {formatFcfa(lease.monthlyRent - alreadyPaid - alloc.items[0].amount)} dû ce mois-là. 1 quittance.
                </>
              )}
              {alloc.monthsCovered > 1 && (
                <>
                  <span className="font-label-md text-ink">{alloc.monthsCovered} mois</span> :{" "}
                  {alloc.items.map((it, i) => (
                    <span key={it.coversMonth}>
                      {i > 0 && ", "}
                      {monthLabelFr(it.coversMonth)}
                      {it.completes && ` (solde de ${formatFcfa(it.amount)})`}
                      {it.isPartial && ` (${formatFcfa(it.amount)}, avance partielle)`}
                    </span>
                  ))}
                  {" — "}
                  {alloc.monthsCovered} quittances.
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mode de règlement" htmlFor="method" required>
              <select
                id="method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Date de paiement" htmlFor="paidAt" required>
              <Input id="paidAt" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Note (optionnel)" htmlFor="notes">
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Enregistrement…" : "Enregistrer le paiement"}
          </Button>
        </form>
      )}

      {!canManage ? (
        <p className="flex items-center gap-2 text-body-sm text-ink-muted">
          <Lock size={14} /> Historique des paiements réservé à la comptabilité ou à un employé avec la permission « Locataires ».
        </p>
      ) : lease.payments.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Aucun paiement enregistré pour ce bail.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <MonthGroupsToolbar count={paymentGroups.groups.length} allOpen={paymentGroups.allOpen} onSetAll={paymentGroups.setAll} />
          <Table>
            <TableHeader>
              <tr>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Enregistré par</TableHead>
                <TableHead className="text-right">Quittance</TableHead>
              </tr>
            </TableHeader>
            {paymentGroups.groups.map((g, i) => {
              const open = paymentGroups.isOpen(g.month, i);
              const paid = sumBy(g.items, (p) => p.amount);
              const settled = paid >= lease.monthlyRent;
              return (
                <TableBody key={g.month || "sans-date"}>
                  <MonthHeaderRow
                    colSpan={5}
                    noun="Loyer"
                    month={g.month}
                    open={open}
                    onToggle={() => paymentGroups.toggle(g.month, i)}
                    badge={
                      settled ? (
                        <Badge variant="success">Payé</Badge>
                      ) : (
                        <Badge variant="warning">Partiel · reste {formatFcfa(lease.monthlyRent - paid)}</Badge>
                      )
                    }
                    summary={
                      <>
                        {countLabel(g.items.length, "paiement")} ·{" "}
                        <span className="tabular font-label-md text-ink">
                          {formatFcfa(paid)} / {formatFcfa(lease.monthlyRent)}
                        </span>
                      </>
                    }
                  />
                  {open &&
                    g.items.map((p) => (
                      <TableRow key={p.id}>
                        <TableAmount>{formatFcfa(p.amount)}</TableAmount>
                        <TableCell className="text-ink-soft">{p.paymentMethodLabel}</TableCell>
                        <TableCell className="text-ink-soft">{p.paidAt}</TableCell>
                        <TableCell className="text-ink-soft">
                          {p.recordedBy ? `${p.recordedBy.name} (${p.recordedBy.roleLabel})` : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.receipt && canManage && (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => accessToken && openAuthenticatedPdf(receiptPdfPath(lease.id, p.id), accessToken)}
                                className="inline-flex items-center gap-1 font-label-sm text-primary hover:underline"
                              >
                                <FileText size={14} />
                                {p.receipt.number}
                              </button>
                              <DocumentDownloadStatus
                                documentType="quittance"
                                referenceId={p.id}
                                accessToken={accessToken}
                                isDg={isDg}
                              />
                              <ResendReceiptButton
                                leaseId={lease.id}
                                paymentId={p.id}
                                coversMonth={p.coversMonth}
                                amount={p.amount}
                                renterFirstName={renterFirstName}
                                renterPhone={renterPhone}
                                companyName={tenant?.companyName}
                                accessToken={accessToken}
                              />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              );
            })}
          </Table>
        </div>
      )}
    </div>
    <ConfirmDialog
      open={confirming}
      icon={Receipt}
      title="Enregistrer ce paiement ?"
      description={
        <>
          <span className="font-label-md text-ink">{formatFcfa(Number(amount) || 0)}</span> pour{" "}
          <span className="font-label-md text-ink">{renterFirstName}</span>, par{" "}
          {PAYMENT_METHODS.find((m) => m.value === method)?.label.toLowerCase() ?? method}, daté du{" "}
          {new Date(`${paidAt}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.
        </>
      }
      confirmLabel="Confirmer le paiement"
      confirmVariant="success"
      busy={submitting}
      onConfirm={doSubmit}
      onCancel={() => setConfirming(false)}
    />
    </>
  );
}

/**
 * Renvoyer une quittance ANCIENNE (pas seulement celle qui vient d'être
 * générée) — même lien de partage (idempotent), généré à la demande plutôt
 * que pour chaque ligne de l'historique au chargement.
 */
export function ResendReceiptButton({
  leaseId,
  paymentId,
  coversMonth,
  amount,
  renterFirstName,
  renterPhone,
  companyName,
  accessToken,
}: {
  leaseId: number;
  paymentId: number;
  coversMonth: string;
  amount: number;
  renterFirstName: string;
  renterPhone: string;
  companyName?: string | null;
  accessToken: string | null;
}) {
  const [loading, setLoading] = React.useState(false);

  async function handleClick() {
    if (!accessToken || loading) return;
    setLoading(true);
    try {
      const { token } = await generateReceiptShareLink(accessToken, leaseId, paymentId);
      const message = buildReceiptMessage({ renterFirstName, coversMonth, amount, url: receiptShareUrl(token), companyName });
      window.open(buildWhatsAppHref(renterPhone, message), "_blank", "noopener,noreferrer");
    } catch {
      // Best-effort — la quittance reste consultable via le bouton de
      // téléchargement juste à côté même si l'envoi échoue.
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-label="Envoyer la quittance par WhatsApp"
      title="Envoyer par WhatsApp"
      className="inline-flex items-center gap-1 text-success-fg hover:underline disabled:opacity-50"
    >
      <Send size={14} />
    </button>
  );
}
