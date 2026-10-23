"use client";

import * as React from "react";
import { HandCoins, Send } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  PAYMENT_PURPOSE_LABELS,
  createPaymentOrder,
  type CreatePaymentInput,
  type PaymentOperator,
  type PaymentOrder,
  type PaymentPurpose,
} from "@/lib/api/payments";
import { createPayslip, PAYSLIP_PAYMENT_METHOD_LABELS, type PayslipPaymentMethod, type StaffMember } from "@/lib/api/payslips";
import { createPayout, type OwnerListItem } from "@/lib/api/owners";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { formatFcfa } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/lib/toast/toast-context";

const selectCls = "h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink";
const digits = (v: string) => v.replace(/\D/g, "");
const today = () => new Date().toISOString().slice(0, 10);

/** Ce que l'opération mouvemente en comptabilité — affiché dans le récapitulatif avant toute validation manuelle. */
const ACCOUNTING_EFFECT: Record<string, string> = {
  salaire: "Charge « Salaires » (dépense) et sortie de la trésorerie du mode choisi. Une fiche de paie est générée.",
  reversement_proprietaire: "Diminue la somme due au propriétaire (compte mandants 4671) et sort de la trésorerie du mode choisi.",
};

/**
 * Nouveau paiement — deux modes selon la configuration :
 *  - FedaPay ACTIF : tout salaire / reversement part en Mobile Money via FedaPay (mot de passe exigé), jamais en saisie libre ;
 *  - FedaPay INACTIF : saisie du paiement déjà effectué, avec récapitulatif de confirmation avant enregistrement.
 */
export function NewPaymentForm({
  accessToken,
  fedapay,
  isDg,
  staff,
  owners,
  presetUserId,
  onDone,
  onCancel,
}: {
  accessToken: string | null;
  fedapay: boolean;
  isDg: boolean;
  staff: StaffMember[];
  owners: OwnerListItem[];
  presetUserId?: number | null;
  onDone: (order: PaymentOrder | null) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const { key: idempotencyKey, renew } = useIdempotencyKey();
  const purposes: PaymentPurpose[] = fedapay
    ? ["salaire", "reversement_proprietaire", "autre"]
    : ["salaire", "reversement_proprietaire"];
  const [purpose, setPurpose] = React.useState<PaymentPurpose>(presetUserId ? "salaire" : purposes[0]);
  const [userId, setUserId] = React.useState(presetUserId ? String(presetUserId) : "");
  const [ownerId, setOwnerId] = React.useState("");
  const [period, setPeriod] = React.useState(new Date().toISOString().slice(0, 7));
  const [baseAmount, setBaseAmount] = React.useState("");
  const [bonusAmount, setBonusAmount] = React.useState("");
  const [deductionAmount, setDeductionAmount] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [periodLabel, setPeriodLabel] = React.useState("");
  const [beneficiaryName, setBeneficiaryName] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [operator, setOperator] = React.useState<PaymentOperator>("mtn");
  const [changeNumber, setChangeNumber] = React.useState(false);
  const [saveNumber, setSaveNumber] = React.useState(true);
  const [password, setPassword] = React.useState("");
  const [method, setMethod] = React.useState<PayslipPaymentMethod>("especes");
  const [paidAt, setPaidAt] = React.useState(today());
  const [notes, setNotes] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const employee = staff.find((s) => String(s.id) === userId) ?? null;
  const owner = owners.find((o) => String(o.id) === ownerId) ?? null;
  const hasSavedNumber = purpose === "salaire" && !!employee?.momoPhoneMasked && !changeNumber;

  // Le salaire de base mémorisé est proposé dès le choix de l'employé.
  React.useEffect(() => {
    if (purpose === "salaire" && employee?.baseSalary != null) setBaseAmount(String(employee.baseSalary));
    setChangeNumber(false);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const gross = (Number(baseAmount) || 0) + (Number(bonusAmount) || 0);
  const net = gross - (Number(deductionAmount) || 0);
  const total = purpose === "salaire" ? net : Number(amount) || 0;

  const beneficiaryLabel =
    purpose === "salaire" ? (employee ? `${employee.firstName} ${employee.lastName}` : "") : purpose === "autre" ? beneficiaryName : owner?.name ?? "";

  function validate(): string | null {
    if (purpose === "salaire") {
      if (!userId) return "Choisissez l'employé.";
      if ((Number(baseAmount) || 0) <= 0) return "Salaire de base invalide.";
      if (net <= 0) return "Le net à payer doit être supérieur à 0.";
    } else if (purpose === "autre") {
      if (beneficiaryName.trim().length < 2 || label.trim().length < 3) return "Renseignez le bénéficiaire et le motif.";
    } else if (!ownerId) {
      return "Choisissez le propriétaire.";
    }
    if (purpose !== "salaire" && total <= 0) return "Montant invalide.";
    if (purpose === "reversement_proprietaire" && !periodLabel.trim()) return "Indiquez la période concernée.";
    if (fedapay) {
      if (!hasSavedNumber && phone.trim().length < 8) return "Numéro Mobile Money requis.";
      if (!password) return "Votre mot de passe est requis.";
    }
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) return setError(problem);
    setError(null);
    if (fedapay) void sendFedapay();
    else setConfirmOpen(true); // saisie manuelle : récapitulatif d'abord
  }

  async function sendFedapay() {
    if (!accessToken) return;
    const common = {
      ...(hasSavedNumber ? {} : { phone: phone.trim(), operator }),
      password,
      idempotencyKey,
    };
    let input: CreatePaymentInput;
    if (purpose === "salaire") {
      input = {
        purpose, userId: Number(userId), period, baseAmount: Number(baseAmount) || 0,
        bonusAmount: Number(bonusAmount) || undefined, deductionAmount: Number(deductionAmount) || undefined,
        saveNumber: !hasSavedNumber && saveNumber, ...common,
      };
    } else if (purpose === "autre") {
      input = { purpose, beneficiaryName: beneficiaryName.trim(), amount: total, label: label.trim(), ...common };
    } else {
      input = { purpose, ownerId: Number(ownerId), amount: total, periodLabel: periodLabel.trim(), ...common };
    }
    setSubmitting(true);
    try {
      const res = await createPaymentOrder(accessToken, input);
      toast.success(res.replayed ? "Ce paiement existait déjà." : "Paiement transmis — en attente de confirmation.");
      renew();
      setPassword("");
      onDone(res.order);
    } catch (err) {
      setPassword("");
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer ce paiement.");
    } finally {
      setSubmitting(false);
    }
  }

  async function recordManual() {
    if (!accessToken) return;
    setSubmitting(true);
    try {
      if (purpose === "salaire") {
        await createPayslip(accessToken, {
          userId: Number(userId), period, baseAmount: Number(baseAmount) || 0,
          bonusAmount: Number(bonusAmount) || undefined, deductionAmount: Number(deductionAmount) || undefined,
          paymentMethod: method, paidAt, idempotencyKey,
        });
      } else if (purpose === "reversement_proprietaire") {
        await createPayout(accessToken, Number(ownerId), {
          amount: total, periodLabel: periodLabel.trim(), paidAt, paymentMethod: method, notes: notes.trim() || undefined, idempotencyKey,
        });
      }
      toast.success("Paiement enregistré.");
      renew();
      setConfirmOpen(false);
      onDone(null);
    } catch (err) {
      setConfirmOpen(false);
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce paiement.");
    } finally {
      setSubmitting(false);
    }
  }

  const salaryFields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field label="Employé" htmlFor="pay-user" required>
        <select id="pay-user" value={userId} onChange={(e) => setUserId(e.target.value)} className={selectCls}>
          <option value="">—</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>
          ))}
        </select>
      </Field>
      <Field label="Période" htmlFor="pay-period" required>
        <Input id="pay-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
      </Field>
      <Field label="Salaire de base (FCFA)" htmlFor="pay-base" required>
        <Input id="pay-base" inputMode="numeric" value={baseAmount} onChange={(e) => setBaseAmount(digits(e.target.value))} />
      </Field>
      <Field label="Prime (FCFA)" htmlFor="pay-bonus">
        <Input id="pay-bonus" inputMode="numeric" value={bonusAmount} onChange={(e) => setBonusAmount(digits(e.target.value))} />
      </Field>
      <Field label="Retenue (FCFA)" htmlFor="pay-deduction">
        <Input id="pay-deduction" inputMode="numeric" value={deductionAmount} onChange={(e) => setDeductionAmount(digits(e.target.value))} />
      </Field>
      <div className="flex flex-col justify-end rounded-lg border border-border bg-surface-muted px-3 py-2 text-body-sm">
        <span className="text-ink-muted">Net à payer</span>
        <span className="tabular font-currency-table text-headline-sm text-ink">{formatFcfa(Math.max(net, 0))}</span>
      </div>
    </div>
  );

  return (
    <Card className="relative z-10 border-primary/30">
      <CardHeader>
        <CardTitle>Nouveau paiement</CardTitle>
        <CardDescription>
          {fedapay
            ? "FedaPay est activé : le paiement part en Mobile Money. Vérifiez soigneusement le numéro, un envoi ne s'annule pas."
            : "Saisissez un paiement déjà effectué. Un récapitulatif vous sera présenté avant tout enregistrement."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" autoComplete="off">
          {error && (
            <div role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>
          )}
          <Field label="Objet" htmlFor="pay-purpose">
            <select id="pay-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as PaymentPurpose)} className={selectCls}>
              {purposes.filter((p) => isDg || p !== "salaire").map((p) => (
                <option key={p} value={p}>{PAYMENT_PURPOSE_LABELS[p]}</option>
              ))}
            </select>
          </Field>

          {purpose === "salaire" && salaryFields}

          {purpose === "reversement_proprietaire" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Propriétaire" htmlFor="pay-owner" required>
                <select id="pay-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={selectCls}>
                  <option value="">—</option>
                  {owners.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
                </select>
              </Field>
              <Field label="Montant (FCFA)" htmlFor="pay-amount" required hint="Ne peut pas dépasser le solde dû (contrôlé par le serveur).">
                <Input id="pay-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} />
              </Field>
              <Field label="Période concernée" htmlFor="pay-period-label" required>
                <Input id="pay-period-label" value={periodLabel} maxLength={50} placeholder="Octobre 2026" onChange={(e) => setPeriodLabel(e.target.value)} />
              </Field>
            </div>
          )}

          {purpose === "autre" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Bénéficiaire" htmlFor="pay-name" required>
                <Input id="pay-name" value={beneficiaryName} maxLength={100} onChange={(e) => setBeneficiaryName(e.target.value)} />
              </Field>
              <Field label="Montant (FCFA)" htmlFor="pay-amount-o" required>
                <Input id="pay-amount-o" inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} />
              </Field>
              <Field label="Motif" htmlFor="pay-label" required>
                <Input id="pay-label" value={label} maxLength={190} onChange={(e) => setLabel(e.target.value)} />
              </Field>
            </div>
          )}

          {fedapay ? (
            <>
              {hasSavedNumber ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-body-sm">
                  <span className="text-ink-muted">Compte Mobile Money enregistré :</span>
                  <span className="tabular text-ink">{employee?.momoOperator?.toUpperCase()} {employee?.momoPhoneMasked}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setChangeNumber(true)}>Changer le numéro</Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Numéro Mobile Money" htmlFor="pay-phone" required>
                    <Input id="pay-phone" inputMode="tel" value={phone} maxLength={20} placeholder="01 97 00 11 22" onChange={(e) => setPhone(e.target.value)} />
                  </Field>
                  <Field label="Opérateur" htmlFor="pay-operator" required>
                    <select id="pay-operator" value={operator} onChange={(e) => setOperator(e.target.value as PaymentOperator)} className={selectCls}>
                      <option value="mtn">MTN</option>
                      <option value="moov">Moov</option>
                    </select>
                  </Field>
                  {purpose === "salaire" && (
                    <label className="flex items-center gap-2 text-body-sm text-ink-soft sm:col-span-2">
                      <input type="checkbox" checked={saveNumber} onChange={(e) => setSaveNumber(e.target.checked)} />
                      Mémoriser ce numéro sur la fiche de l&apos;employé (affiché masqué ensuite)
                    </label>
                  )}
                </div>
              )}
              <Field label="Votre mot de passe" htmlFor="pay-password" required hint="Demandé à chaque envoi d'argent.">
                <Input id="pay-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Mode de règlement" htmlFor="pay-method" required>
                <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PayslipPaymentMethod)} className={selectCls}>
                  {Object.entries(PAYSLIP_PAYMENT_METHOD_LABELS).map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
                </select>
              </Field>
              <Field label="Date du règlement" htmlFor="pay-date" required>
                <Input id="pay-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </Field>
              {purpose !== "salaire" && (
                <Field label="Note (optionnel)" htmlFor="pay-notes">
                  <Input id="pay-notes" value={notes} maxLength={255} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>Annuler</Button>
            <Button type="submit" disabled={submitting || (fedapay && !password)}>
              <Send size={14} /> {fedapay ? (submitting ? "Envoi…" : "Envoyer le paiement") : "Vérifier et enregistrer"}
            </Button>
          </div>
        </form>

        <ConfirmDialog
          open={confirmOpen}
          icon={HandCoins}
          title="Confirmer ce paiement"
          confirmLabel="Oui, enregistrer"
          busy={submitting}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={recordManual}
          description={
            <div className="flex flex-col gap-2 text-body-sm">
              <p className="tabular font-currency-table text-headline-sm text-ink">{formatFcfa(total)}</p>
              <p>
                <span className="text-ink-muted">{PAYMENT_PURPOSE_LABELS[purpose]} · </span>
                <span className="text-ink">{beneficiaryLabel || "—"}</span>
              </p>
              <p className="text-ink-muted">
                {PAYSLIP_PAYMENT_METHOD_LABELS[method]} · {new Date(paidAt).toLocaleDateString("fr-FR")}
              </p>
              <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-body-xs text-ink-soft">
                {ACCOUNTING_EFFECT[purpose]}
              </p>
            </div>
          }
        />
      </CardContent>
    </Card>
  );
}
