"use client";

import * as React from "react";
import { ShieldCheck, ShieldX, ScanLine } from "lucide-react";
import { verifyDocumentCode, type DocumentVerificationResult } from "@/lib/api/documents";
import { ApiError } from "@/lib/api/client";
import { formatDateLabel } from "@/lib/utils";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Page publique de vérification d'authenticité (étape 29) : aucun compte,
 * aucun token — le code imprimé en pied de page d'une quittance/attestation/
 * relevé suffit. Ne montre jamais de montant ni de nom de locataire/
 * propriétaire, seulement de quoi confirmer que le document est réel.
 */
function formatCodeInput(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return [clean.slice(0, 4), clean.slice(4, 8), clean.slice(8, 12)].filter(Boolean).join("-");
}

export function VerifierView() {
  const [code, setCode] = React.useState("");
  const [result, setResult] = React.useState<DocumentVerificationResult | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 14) return;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const res = await verifyDocumentCode(code);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Vérification impossible, réessayez.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:py-20">
        <div className="w-full max-w-md">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-bg text-primary">
              <ShieldCheck size={26} />
            </span>
            <h1 className="font-display text-headline-lg text-ink">Vérifier un document</h1>
            <p className="max-w-sm text-body-md text-ink-soft">
              Confirmez en quelques secondes qu&apos;une quittance, une attestation de loyer ou un
              relevé propriétaire a bien été émis par Lyko System.
            </p>
          </div>

          <Card className="shadow-md">
            <CardContent className="flex flex-col gap-5 p-5 sm:p-6">
              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                <Field
                  label="Code de vérification"
                  htmlFor="code"
                  required
                  hint="Imprimé en bas du document, ex. K7XM-9QRT-4LPW"
                >
                  <div className="relative">
                    <ScanLine
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
                    />
                    <Input
                      id="code"
                      value={code}
                      onChange={(e) => setCode(formatCodeInput(e.target.value))}
                      placeholder="XXXX-XXXX-XXXX"
                      className="tabular h-12 pl-10 text-center font-currency-table text-headline-sm uppercase tracking-[0.15em]"
                      maxLength={14}
                      autoFocus
                    />
                  </div>
                </Field>
                {error && <p className="text-body-sm text-danger-fg">{error}</p>}
                <Button type="submit" className="w-full" disabled={checking || code.length < 14}>
                  {checking ? "Vérification…" : "Vérifier le document"}
                </Button>
              </form>

              {result && (
                <div
                  className={
                    result.valid
                      ? "flex flex-col items-center gap-2.5 rounded-lg border border-success-border bg-success-bg px-5 py-6 text-center"
                      : "flex flex-col items-center gap-2.5 rounded-lg border border-danger-border bg-danger-bg px-5 py-6 text-center"
                  }
                >
                  {result.valid ? (
                    <>
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success text-white">
                        <ShieldCheck size={22} />
                      </span>
                      <p className="font-display text-headline-sm text-success-fg">Document authentique</p>
                      <Badge variant="success">{result.documentTypeLabel}</Badge>
                      <p className="text-body-sm text-ink-soft">
                        Émis par <span className="font-label-md text-ink">{result.companyName}</span>
                        {result.issuedAt && ` le ${formatDateLabel(result.issuedAt.slice(0, 10))}`}.
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger text-white">
                        <ShieldX size={22} />
                      </span>
                      <p className="font-display text-headline-sm text-danger-fg">Code invalide</p>
                      <p className="text-body-sm text-ink-soft">
                        Ce code ne correspond à aucun document connu. Vérifiez qu&apos;il est bien
                        recopié tel qu&apos;il apparaît sur le document.
                      </p>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="mt-5 text-center text-body-xs text-ink-muted">
            Par souci de confidentialité, aucun nom ni montant n&apos;est affiché ici — seule
            l&apos;authenticité du document est confirmée.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
