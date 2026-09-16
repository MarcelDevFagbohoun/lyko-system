"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Stamp, PenTool } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, API_URL } from "@/lib/api/client";
import { RequireAuth } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

/**
 * Cachet/signature personnels de l'employé connecté (comptable, agent ou
 * DG) — demande directe de l'utilisateur : sur une quittance, ce doit être
 * le cachet de celui qui a réellement encaissé le paiement, pas seulement
 * celui de l'entreprise (Réglages, DG uniquement). Tant qu'un employé n'a
 * pas téléversé les siens, la quittance retombe sur ceux de l'entreprise —
 * rien ne change pour lui.
 */
export function MonCompteView() {
  return (
    <RequireAuth>
      <MonCompteContent />
    </RequireAuth>
  );
}

function MonCompteContent() {
  const { user, updateMySignature } = useAuth();
  const [stampFile, setStampFile] = React.useState<File | null>(null);
  const [stampPreview, setStampPreview] = React.useState<string | null>(null);
  const [signatureFile, setSignatureFile] = React.useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = React.useState<string | null>(null);

  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleStampChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setStampFile(file);
    setStampPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }
  function handleSignatureChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSignatureFile(file);
    setSignaturePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!stampFile && !signatureFile) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateMySignature({ stamp: stampFile ?? undefined, signature: signatureFile ?? undefined });
      setStampFile(null);
      setSignatureFile(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer le cachet/la signature.");
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  const currentStamp = stampPreview ?? (user.stampUrl ? `${API_URL}${user.stampUrl}` : null);
  const currentSignature = signaturePreview ?? (user.signatureUrl ? `${API_URL}${user.signatureUrl}` : null);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour à mon espace
        </Link>

        <div>
          <h1 className="font-display text-headline-xl text-ink">Mon compte</h1>
          <p className="text-body-md text-ink-soft">
            Votre cachet et votre signature personnels, apposés sur les quittances des paiements que
            vous enregistrez vous-même. Tant que vous n&apos;en avez pas téléversé, celles-ci utilisent
            le cachet et la signature de l&apos;entreprise.
          </p>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-6">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}
          {saved && (
            <div className="rounded-lg border border-success-border bg-success-bg px-3 py-2 text-body-sm text-success-fg">
              Cachet/signature enregistrés.
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Mon cachet</CardTitle>
                <CardDescription>Apposé sur les quittances des paiements que vous encaissez.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted">
                  {currentStamp ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={currentStamp} alt="Cachet" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <Stamp size={28} className="text-ink-faint" />
                  )}
                </div>
                <label className="cursor-pointer font-label-sm text-primary hover:underline">
                  {currentStamp ? "Remplacer mon cachet" : "Téléverser mon cachet"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleStampChange} className="hidden" />
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ma signature</CardTitle>
                <CardDescription>Apposée près de votre nom sur ces mêmes quittances.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <div className="flex h-28 w-full items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted">
                  {currentSignature ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={currentSignature} alt="Signature" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <PenTool size={28} className="text-ink-faint" />
                  )}
                </div>
                <label className="cursor-pointer font-label-sm text-primary hover:underline">
                  {currentSignature ? "Remplacer ma signature" : "Téléverser ma signature"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSignatureChange} className="hidden" />
                </label>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardFooter className="justify-end">
              <Button type="submit" size="lg" disabled={saving || (!stampFile && !signatureFile)}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </div>
  );
}
