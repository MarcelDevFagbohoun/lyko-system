"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import { getPayrollLiabilities, getVatReport, payPayrollLiability, payVat, type VatReport } from "@/lib/api/gl";
import type { PaymentMethod } from "@/lib/api/renters";
import { formatFcfa } from "@/lib/utils";
import { useToast } from "@/lib/toast/toast-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
];

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** Dette envers l'État ou la CNSS déjà constatée : cette carte se contente de la solder. */
function LiabilityCard({
  title,
  description,
  balance,
  onPay,
  children,
}: {
  title: string;
  description: string;
  balance: number;
  onPay: (input: { amount: number; paymentMethod: PaymentMethod; paidAt: string }) => Promise<void>;
  children?: React.ReactNode;
}) {
  const [paying, setPaying] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("virement");
  const [paidAt, setPaidAt] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onPay({ amount: Number(amount), paymentMethod: method, paidAt });
      setPaying(false);
      setAmount("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce règlement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-warning-border bg-warning/5">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <p className="tabular font-currency-table text-headline-sm text-warning-fg">{formatFcfa(balance)}</p>
        {children}
        {paying ? (
          <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input inputMode="numeric" placeholder="Montant" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={SELECT_CLASS}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={busy || !amount}>
                {busy ? "Enregistrement…" : "Confirmer le règlement"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPaying(false)} disabled={busy}>
                Annuler
              </Button>
            </div>
          </form>
        ) : (
          <Button
            size="sm"
            variant="warning"
            className="self-start"
            onClick={() => {
              setAmount(String(balance));
              setPaying(true);
            }}
          >
            Enregistrer un règlement
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** TVA collectée, CNSS et ITS dus : n'affiche que ce qui est dû (ou la TVA dès que l'option est active). */
export function StateLiabilities({ accessToken }: { accessToken: string | null }) {
  const toast = useToast();
  const [vat, setVat] = React.useState<VatReport | null>(null);
  const [payroll, setPayroll] = React.useState<{ cnss: number; its: number } | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getVatReport(accessToken).then(setVat).catch(() => setVat(null));
    getPayrollLiabilities(accessToken).then(setPayroll).catch(() => setPayroll(null));
  }, [accessToken]);
  React.useEffect(() => load(), [load]);

  if (!accessToken) return null;
  const showVat = vat && (vat.enabled || vat.balanceOwed !== 0 || vat.months.length > 0);

  return (
    <>
      {showVat && vat && (
        <LiabilityCard
          title="TVA à reverser"
          description={`TVA incluse dans vos commissions (taux ${vat.rate} %), pas encore reversée à l'État.`}
          balance={vat.balanceOwed}
          onPay={async (input) => {
            await payVat(accessToken, input);
            toast.success("TVA reversée.");
            load();
          }}
        >
          {vat.months.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[320px] text-body-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-normal">Mois</th>
                    <th className="px-3 py-1.5 text-right font-normal">Commission HT</th>
                    <th className="px-3 py-1.5 text-right font-normal">TVA</th>
                    <th className="px-3 py-1.5 text-right font-normal">TTC</th>
                  </tr>
                </thead>
                <tbody>
                  {vat.months.map((m) => (
                    <tr key={m.month} className="border-t border-border">
                      <td className="px-3 py-1.5">{m.month}</td>
                      <td className="tabular px-3 py-1.5 text-right">{formatFcfa(m.baseHt)}</td>
                      <td className="tabular px-3 py-1.5 text-right">{formatFcfa(m.tva)}</td>
                      <td className="tabular px-3 py-1.5 text-right">{formatFcfa(m.ttc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LiabilityCard>
      )}
      {payroll && payroll.cnss > 0 && (
        <LiabilityCard
          title="Cotisations CNSS à reverser"
          description="Parts salariale et employeur retenues sur les fiches de paie."
          balance={payroll.cnss}
          onPay={async (input) => {
            await payPayrollLiability(accessToken, { kind: "cnss", ...input });
            toast.success("Cotisations CNSS reversées.");
            load();
          }}
        />
      )}
      {payroll && payroll.its > 0 && (
        <LiabilityCard
          title="ITS à reverser au fisc"
          description="Impôt sur traitements et salaires retenu sur les fiches de paie."
          balance={payroll.its}
          onPay={async (input) => {
            await payPayrollLiability(accessToken, { kind: "its", ...input });
            toast.success("ITS reversé.");
            load();
          }}
        />
      )}
    </>
  );
}
