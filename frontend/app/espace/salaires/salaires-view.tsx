"use client";

import * as React from "react";
import Link from "next/link";
import { FileDown, Trash2, Banknote, Send } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  listStaff,
  updateBaseSalary,
  listPayslips,
  createPayslip,
  deletePayslip,
  payslipPdfPath,
  PAYSLIP_PAYMENT_METHOD_LABELS,
  type StaffMember,
  type Payslip,
  type PayslipPaymentMethod,
} from "@/lib/api/payslips";
import { RequireAuth } from "@/components/auth/require-auth";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { formatFcfa } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";

/**
 * Salaires (demande utilisateur, 2026-10-18) : paiement du salaire d'un employé (comptable, agent
 * ou le DG lui-même — décision explicite de l'utilisateur). Réservé au DG, comme la gestion des
 * employés (`/espace/employes`), mais cette page-ci couvre AUSSI le DG — `GET /api/payslips/staff`
 * liste tout le personnel, contrairement à `/api/employees` qui exclut le DG.
 */
export function SalairesView() {
  return (
    <RequireAuth roles={["dg"]}>
      <SalairesContent />
    </RequireAuth>
  );
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function SalairesContent() {
  const { accessToken } = useAuth();
  const [staff, setStaff] = React.useState<StaffMember[] | null>(null);
  const [payslips, setPayslips] = React.useState<Payslip[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [payingFor, setPayingFor] = React.useState<StaffMember | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    Promise.all([listStaff(accessToken), listPayslips(accessToken)])
      .then(([staffRes, payslipsRes]) => {
        setStaff(staffRes.staff);
        setPayslips(payslipsRes.payslips);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les salaires."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Salaires</h1>
            <p className="text-body-md text-ink-soft">
              Paiement des salaires du personnel — chaque fiche de paie réduit la recette de l&apos;entreprise et peut être téléchargée, signée par vous.
            </p>
          </div>
          <Link href="/espace/paiements">
            <Button variant="secondary">
              <Send size={16} /> Payer par Mobile Money (FedaPay)
            </Button>
          </Link>
        </div>
        <p className="-mt-3 text-body-xs text-ink-muted">
          Le formulaire ci-dessous enregistre un salaire déjà réglé (espèces, virement…). Pour l&apos;envoyer réellement en Mobile
          Money, utilisez « Payer par Mobile Money » ci-dessus — il crée la fiche de paie automatiquement une fois confirmé.
        </p>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>
        )}

        <Card className="relative z-10">
          <CardHeader>
            <CardTitle>Personnel</CardTitle>
            <CardDescription>Salaire de base mémorisé par compte — proposé par défaut à chaque paiement, ajustable avant validation.</CardDescription>
          </CardHeader>
          <CardContent>
            {!staff ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : staff.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucun compte actif.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead>Salaire de base</TableHead>
                    <TableHead>Dernière fiche de paie</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.map((s) => (
                    <StaffRow
                      key={s.id}
                      staff={s}
                      accessToken={accessToken}
                      onBaseSalaryChanged={load}
                      onPay={() => setPayingFor(s)}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {payingFor && (
          <PayslipForm
            staff={payingFor}
            accessToken={accessToken}
            onCreated={() => {
              setPayingFor(null);
              load();
            }}
            onCancel={() => setPayingFor(null)}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>Historique des fiches de paie</CardTitle>
          </CardHeader>
          <CardContent>
            {!payslips ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : payslips.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucune fiche de paie émise pour l&apos;instant.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Période</TableHead>
                    <TableHead>Employé</TableHead>
                    <TableHead>Net versé</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.map((p) => (
                    <PayslipRow key={p.id} payslip={p} accessToken={accessToken} onCancelled={load} />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StaffRow({
  staff,
  accessToken,
  onBaseSalaryChanged,
  onPay,
}: {
  staff: StaffMember;
  accessToken: string | null;
  onBaseSalaryChanged: () => void;
  onPay: () => void;
}) {
  const [value, setValue] = React.useState(staff.baseSalary != null ? String(staff.baseSalary) : "");
  const [saving, setSaving] = React.useState(false);
  const toast = useToast();

  async function handleSave() {
    if (!accessToken) return;
    setSaving(true);
    try {
      await updateBaseSalary(accessToken, staff.id, value ? Number(value) : null);
      toast.success("Salaire de base mis à jour.");
      onBaseSalaryChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce salaire de base.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <p className="font-label-md text-ink">
          {staff.firstName} {staff.lastName}
        </p>
      </TableCell>
      <TableCell>
        <Badge variant={staff.role === "dg" ? "info" : "neutral"}>{staff.roleLabel}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
            placeholder="Non défini"
            className="w-32"
          />
          {value !== (staff.baseSalary != null ? String(staff.baseSalary) : "") && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "…" : "OK"}
            </Button>
          )}
        </div>
      </TableCell>
      <TableCell>
        {staff.lastPayslip ? (
          <span className="text-body-sm text-ink-soft">
            {staff.lastPayslip.period} — {formatFcfa(staff.lastPayslip.netAmount)}
          </span>
        ) : (
          <span className="text-body-sm text-ink-muted">Aucune</span>
        )}
      </TableCell>
      <TableCell>
        <Button size="sm" onClick={onPay}>
          <Banknote size={14} />
          Payer le salaire
        </Button>
      </TableCell>
    </TableRow>
  );
}

function PayslipForm({
  staff,
  accessToken,
  onCreated,
  onCancel,
}: {
  staff: StaffMember;
  accessToken: string | null;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [period, setPeriod] = React.useState(currentMonth());
  const [baseAmount, setBaseAmount] = React.useState(staff.baseSalary != null ? String(staff.baseSalary) : "");
  const [bonusAmount, setBonusAmount] = React.useState("");
  const [bonusLabel, setBonusLabel] = React.useState("");
  const [deductionAmount, setDeductionAmount] = React.useState("");
  const [deductionLabel, setDeductionLabel] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState<PayslipPaymentMethod>("especes");
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const { key: idempotencyKey, renew } = useIdempotencyKey();

  const base = Number(baseAmount) || 0;
  const bonus = Number(bonusAmount) || 0;
  const deduction = Number(deductionAmount) || 0;
  const gross = base + bonus;
  const net = gross - deduction;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (base <= 0) return setError("Salaire de base invalide.");
    if (net <= 0) return setError("Le net à payer doit être supérieur à 0.");

    setSubmitting(true);
    setError(null);
    try {
      await createPayslip(accessToken, {
        userId: staff.id,
        period,
        baseAmount: base,
        bonusAmount: bonus || undefined,
        bonusLabel: bonusLabel.trim() || undefined,
        deductionAmount: deduction || undefined,
        deductionLabel: deductionLabel.trim() || undefined,
        paymentMethod,
        paidAt,
        idempotencyKey,
      });
      toast.success(`Salaire de ${staff.firstName} ${staff.lastName} payé.`);
      renew();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce paiement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="relative z-10 border-success-border">
      <CardHeader>
        <CardTitle>
          Payer le salaire de {staff.firstName} {staff.lastName}
        </CardTitle>
        <CardDescription>Une fiche de paie sera générée, signée par vous, et son net viendra réduire la recette de l&apos;entreprise.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Période" htmlFor="period" required>
              <input
                id="period"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </Field>
            <Field label="Salaire de base (FCFA)" htmlFor="baseAmount" required>
              <Input id="baseAmount" inputMode="numeric" value={baseAmount} onChange={(e) => setBaseAmount(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Date de règlement" htmlFor="paidAt" required>
              <Input id="paidAt" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Prime (optionnel)" htmlFor="bonusAmount">
              <Input id="bonusAmount" inputMode="numeric" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Libellé de la prime" htmlFor="bonusLabel">
              <Input id="bonusLabel" value={bonusLabel} onChange={(e) => setBonusLabel(e.target.value)} placeholder="Ex. Prime de performance" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Retenue (optionnel)" htmlFor="deductionAmount">
              <Input
                id="deductionAmount"
                inputMode="numeric"
                value={deductionAmount}
                onChange={(e) => setDeductionAmount(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Libellé de la retenue" htmlFor="deductionLabel">
              <Input id="deductionLabel" value={deductionLabel} onChange={(e) => setDeductionLabel(e.target.value)} placeholder="Ex. Avance déjà versée" />
            </Field>
          </div>
          <Field label="Mode de règlement" htmlFor="paymentMethod" required>
            <select
              id="paymentMethod"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PayslipPaymentMethod)}
              className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {Object.entries(PAYSLIP_PAYMENT_METHOD_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <div className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Salaire brut</span>
              <span className="tabular font-currency-table text-ink">{formatFcfa(gross)}</span>
            </div>
            {deduction > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">Retenue</span>
                <span className="tabular font-currency-table text-danger-fg">− {formatFcfa(deduction)}</span>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between border-t border-border pt-1">
              <span className="font-label-md text-ink">Net à payer</span>
              <span className="tabular font-currency-table text-headline-sm text-ink">{formatFcfa(net)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Enregistrement…" : "Confirmer le paiement"}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Annuler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PayslipRow({
  payslip,
  accessToken,
  onCancelled,
}: {
  payslip: Payslip;
  accessToken: string | null;
  onCancelled: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const toast = useToast();

  async function handleCancel() {
    if (!accessToken) return;
    setSubmitting(true);
    try {
      await deletePayslip(accessToken, payslip.id, reason.trim());
      toast.success("Fiche de paie annulée.");
      onCancelled();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible d'annuler cette fiche.");
      setSubmitting(false);
    }
  }

  return (
    <TableRow>
      <TableCell>{payslip.period}</TableCell>
      <TableCell>{payslip.employee.name}</TableCell>
      <TableAmount>{formatFcfa(payslip.netAmount)}</TableAmount>
      <TableCell>{PAYSLIP_PAYMENT_METHOD_LABELS[payslip.paymentMethod]}</TableCell>
      <TableCell>{new Date(payslip.paidAt).toLocaleDateString("fr-FR")}</TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Télécharger la fiche de paie"
            onClick={() => accessToken && openAuthenticatedPdf(payslipPdfPath(payslip.id), accessToken)}
          >
            <FileDown size={14} />
          </Button>
          {confirming ? (
            <>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motif (5 caractères min.)"
                className="w-44"
              />
              <Button variant="destructive" size="sm" onClick={handleCancel} disabled={submitting || reason.trim().length < 5}>
                Confirmer
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={submitting}>
                Annuler
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" aria-label="Annuler cette fiche de paie" onClick={() => setConfirming(true)}>
              <Trash2 size={14} className="text-danger-fg" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
