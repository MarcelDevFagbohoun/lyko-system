"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { fetchRefundLink, submitRefundLink } from "@/lib/api/billing";
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
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [operator, setOperator] = React.useState<"mtn" | "moov">("mtn");

  React.useEffect(() => {
    fetchRefundLink(token).then(setInfo).catch((e) => setError(e instanceof ApiError ? e.message : "Lien invalide ou expiré."));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitRefundLink(token, { name, phone, operator });
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
          {info && <CardDescription>{info.companyName} — montant à recevoir : {formatFcfa(info.refundAmount)}</CardDescription>}
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 size={32} className="text-success-fg" />
              <p className="font-label-md text-success-fg">Coordonnées enregistrées</p>
              <p className="text-body-sm text-ink-muted">Le virement sera effectué prochainement. Vous recevrez un e-mail de confirmation.</p>
            </div>
          ) : info ? (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <Field label="Nom du titulaire du compte Mobile Money" htmlFor="rn" required>
                <Input id="rn" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} />
              </Field>
              <Field label="Numéro Mobile Money" htmlFor="rp" required hint="Ex. 0197000000">
                <Input id="rp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </Field>
              <Field label="Opérateur" htmlFor="ro" required>
                <select id="ro" value={operator} onChange={(e) => setOperator(e.target.value as "mtn" | "moov")} className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink">
                  <option value="mtn">MTN</option>
                  <option value="moov">Moov</option>
                </select>
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
