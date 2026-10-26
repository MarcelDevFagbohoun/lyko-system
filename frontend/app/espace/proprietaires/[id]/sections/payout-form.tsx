"use client";

import * as React from "react";
import Link from "next/link";
import { Wallet, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { createPayout, type CreatePayoutInput } from "@/lib/api/owners";
import { formatFcfa, formatDateLabel } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/lib/toast/toast-context";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { ConfirmRow } from "./commission-card";
import { PAYMENT_METHODS } from "./shared";

/**
 * Enregistrer un versement est un mouvement d'argent réel vers un tiers :
 * un formulaire seul ne suffit pas. Après saisie, un écran de vérification
 * récapitule explicitement le propriétaire bénéficiaire (nom en toutes
 * lettres, jamais un simple identifiant) avant tout envoi — rien n'est
 * enregistré sans ce second geste explicite.
 */
export function PayoutForm({
  ownerId,
  ownerName,
  accessToken,
  onRecorded,
}: {
  ownerId: number;
  ownerName: string;
  accessToken: string | null;
  onRecorded: () => void;
}) {
  // /espace/paiements est réservé à roles={["dg","comptable"]} — un agent avec la seule permission
  // `proprietaires` (qui peut ouvrir ce formulaire) n'y a pas accès : lien mort sinon (audit du
  // 2026-10-23). Le reste du formulaire ci-dessous reste disponible à cet agent.
  const { user: payoutFormUser } = useAuth();
  const canUseFedapayPage = payoutFormUser?.role === "dg" || payoutFormUser?.role === "comptable";
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<"form" | "confirm">("form");
  const [amount, setAmount] = React.useState("");
  // La période est choisie dans un calendrier (jour inclus — primordial,
  // pas seulement le mois), jamais saisie à la main — le libellé français
  // ("6 juin 2026") en est simplement dérivé.
  const [periodDate, setPeriodDate] = React.useState("");
  const periodLabel = periodDate ? formatDateLabel(periodDate) : "";
  const [method, setMethod] = React.useState<CreatePayoutInput["paymentMethod"]>("virement");
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const methodLabel = PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
  const toast = useToast();
  const idem = useIdempotencyKey();

  function reset() {
    setOpen(false);
    setStep("form");
    setAmount("");
    setPeriodDate("");
    setNotes("");
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError("Montant invalide.");
    if (!periodDate) return setError("Période requise.");
    if (!paidAt) return setError("Date requise.");
    setStep("confirm");
  }

  async function handleConfirm() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await createPayout(accessToken, ownerId, {
        amount: Number(amount),
        periodLabel,
        paidAt,
        paymentMethod: method,
        notes: notes.trim() || undefined,
        idempotencyKey: idem.key,
      });
      idem.renew();
      const paidAmount = Number(amount);
      reset();
      onRecorded();
      toast.success(`Versement de ${formatFcfa(paidAmount)} enregistré pour ${ownerName}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce versement.");
      setStep("form");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Nouveau versement</span>
        <Button variant="success" size="sm" onClick={() => (open ? reset() : setOpen(true))}>
          <Wallet size={14} />
          {open ? "Fermer" : "Enregistrer un versement"}
        </Button>
      </div>
      <p className="text-body-xs text-ink-muted">
        Ce formulaire enregistre un versement déjà réglé (espèces, virement…).
        {canUseFedapayPage ? (
          <>
            {" "}Pour l&apos;envoyer réellement en Mobile Money via FedaPay,{" "}
            <Link href="/espace/paiements" className="text-primary hover:underline">
              utilisez la page Paiements
            </Link>{" "}
            — le versement y est enregistré automatiquement une fois confirmé.
          </>
        ) : (
          " Pour l'envoyer réellement en Mobile Money via FedaPay, demandez au DG ou au comptable."
        )}
      </p>

      {open && error && <p className="text-body-sm text-danger-fg">{error}</p>}

      {open && step === "form" && (
        <form onSubmit={handleReview} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Période" htmlFor="periodDate" required hint="Date concernée par ce versement (le jour compte)">
              <Input id="periodDate" type="date" value={periodDate} onChange={(e) => setPeriodDate(e.target.value)} />
            </Field>
            <Field label="Montant (FCFA)" htmlFor="payoutAmount" required>
              <Input id="payoutAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mode de règlement" htmlFor="payoutMethod" required>
              <select
                id="payoutMethod"
                value={method}
                onChange={(e) => setMethod(e.target.value as CreatePayoutInput["paymentMethod"])}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Date du versement" htmlFor="payoutDate" required>
              <Input id="payoutDate" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Note (optionnel)" htmlFor="payoutNotes">
            <Input id="payoutNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button type="submit" className="self-start">
            Vérifier le versement
          </Button>
        </form>
      )}

      {open && step === "confirm" && (
        <div className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-surface-muted p-4">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck size={18} />
            <span className="font-label-md">Vérifiez ce versement avant confirmation</span>
          </div>

          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            <ConfirmRow label="Propriétaire bénéficiaire" value={ownerName} strong />
            <ConfirmRow label="Montant" value={formatFcfa(Number(amount))} strong />
            <ConfirmRow label="Période concernée" value={periodLabel} />
            <ConfirmRow label="Mode de règlement" value={methodLabel} />
            <ConfirmRow label="Date du versement" value={paidAt} />
            {notes.trim() && <ConfirmRow label="Note" value={notes.trim()} />}
          </div>

          <p className="text-body-xs text-ink-muted">
            Cette action enregistre un versement réel dans l&apos;historique du propriétaire. Vérifiez le nom du
            bénéficiaire et le montant avant de confirmer.
          </p>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep("form")} disabled={submitting}>
              Modifier
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={submitting}>
              {submitting ? "Enregistrement…" : `Confirmer le versement à ${ownerName}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Taux de commission du cabinet sur la recette nette de chaque Bien de ce
 * propriétaire — DG uniquement pour la modification (cahier des charges).
 * Comme pour un versement, un changement de taux est un acte de gérance :
 * un écran de vérification récapitule l'ancien et le nouveau taux avant tout
 * envoi. Aucun taux n'est jamais écrasé, seulement clôturé puis remplacé —
 * l'historique complet reste affiché sous le formulaire.
 */
