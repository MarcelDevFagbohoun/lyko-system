"use client";

import * as React from "react";
import { ShieldCheck, ShieldX, FileSearch } from "lucide-react";
import { verifyDocumentCode, type DocumentVerificationResult } from "@/lib/api/documents";
import { ApiError } from "@/lib/api/client";
import { formatDateLabel } from "@/lib/utils";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

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
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileSearch size={20} className="text-primary" />
                <CardTitle>Vérifier un document</CardTitle>
              </div>
              <CardDescription>
                Entrez le code imprimé en bas de la quittance, de l&apos;attestation ou du relevé
                pour confirmer qu&apos;il a bien été émis par Lyko System.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
                <Field label="Code de vérification" htmlFor="code" required hint="Ex. K7XM-9QRT-4LPW">
                  <Input
                    id="code"
                    value={code}
                    onChange={(e) => setCode(formatCodeInput(e.target.value))}
                    placeholder="XXXX-XXXX-XXXX"
                    className="tabular text-center font-currency-table uppercase tracking-wider"
                    maxLength={14}
                  />
                </Field>
                {error && <p className="text-body-sm text-danger-fg">{error}</p>}
                <Button type="submit" disabled={checking || code.length < 14}>
                  {checking ? "Vérification…" : "Vérifier"}
                </Button>
              </form>

              {result && (
                <div
                  className={
                    result.valid
                      ? "flex flex-col items-center gap-2 rounded-lg border border-success-border bg-success-bg px-4 py-5 text-center"
                      : "flex flex-col items-center gap-2 rounded-lg border border-danger-border bg-danger-bg px-4 py-5 text-center"
                  }
                >
                  {result.valid ? (
                    <>
                      <ShieldCheck size={28} className="text-success-fg" />
                      <p className="font-label-md text-success-fg">Document authentique</p>
                      <p className="text-body-sm text-ink-soft">
                        {result.documentTypeLabel} émise par <span className="font-label-md">{result.companyName}</span>
                        {result.issuedAt && ` le ${formatDateLabel(result.issuedAt.slice(0, 10))}`}.
                      </p>
                    </>
                  ) : (
                    <>
                      <ShieldX size={28} className="text-danger-fg" />
                      <p className="font-label-md text-danger-fg">Code invalide</p>
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
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
