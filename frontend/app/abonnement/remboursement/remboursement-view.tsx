"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { ACCOUNT_TYPE_LABELS, fetchRefundLink, submitRefundLink, type AccountType } from "@/lib/api/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { formatFcfa } from "@/lib/utils";

/** Lien reçu par courriel : l'entreprise indique où recevoir son remboursement (usage unique). */
export function RemboursementView() {
  const token = useSearchParams().get("token") ?? "";
  const [info, setInfo] = React.useState<{ companyName: string; refundAmount: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [lastName, setLastName] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [accountType, setAccountType] = React.useState<AccountType>("mtn");
  const [accountNumber, setAccountNumber] = React.useState("");
  const [accountLabel, setAccountLabel] = React.useState("");
  const [otherDetail, setOtherDetail] = React.useState("");

  React.useEffect(() => {
    fetchRefundLink(token).then(setInfo).catch((e) => setError(e instanceof ApiError ? e.message : "Lien invalide ou expiré."));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitRefundLink(token, { lastName, firstName, accountType, accountNumber, accountLabel, otherDetail: accountType === "autre" ? otherDetail : undefined });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi impossible. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Recevoir mon remboursement</CardTitle>
          {info && <CardDescription>{info.companyName}, montant à recevoir : {formatFcfa(info.refundAmount)}</CardDescription>}
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 size={32} className="text-success-fg" />
              <p className="font-label-md text-success-fg">Coordonnées enregistrées</p>
              <p className="text-body-sm text-ink-muted">Nous allons effectuer le remboursement. Vous recevrez un e-mail de confirmation.</p>
            </div>
          ) : info ? (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nom" htmlFor="rln" required>
                  <Input id="rln" value={lastName} onChange={(e) => setLastName(e.target.value)} required minLength={2} />
                </Field>
                <Field label="Prénom" htmlFor="rfn" required>
                  <Input id="rfn" value={firstName} onChange={(e) => setFirstName(e.target.value)} required minLength={2} />
                </Field>
              </div>
              <Field label="Type de compte" htmlFor="rt" required>
                <select id="rt" value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)} className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink">
                  {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((k) => (
                    <option key={k} value={k}>{ACCOUNT_TYPE_LABELS[k]}</option>
                  ))}
                </select>
              </Field>
              {accountType === "autre" && (
                <Field label="Précisez le type de compte" htmlFor="rod" required>
                  <Input id="rod" value={otherDetail} onChange={(e) => setOtherDetail(e.target.value)} required minLength={2} />
                </Field>
              )}
              <Field label={accountType === "banque" ? "Numéro de compte (ou IBAN)" : "Numéro du compte"} htmlFor="ran" required hint={accountType === "banque" || accountType === "autre" ? undefined : "Ex. 0197000000"}>
                <Input id="ran" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required />
              </Field>
              <Field label="Intitulé du compte" htmlFor="ral" required hint="Le nom sous lequel le compte est enregistré">
                <Input id="ral" value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} required minLength={3} />
              </Field>
              {error && <p className="text-body-sm text-danger-fg">{error}</p>}
              <Button type="submit" disabled={busy}>{busy ? "Envoi…" : "Envoyer mes coordonnées"}</Button>
            </form>
          ) : (
            <p className="text-body-sm text-danger-fg">{error ?? "Chargement…"}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
