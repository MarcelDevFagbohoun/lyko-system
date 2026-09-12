"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Stamp, PenTool, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, API_URL } from "@/lib/api/client";
import { getSettings, updateSettings, type TenantSettings } from "@/lib/api/settings";
import { RequireAuth } from "@/components/auth/require-auth";
import { EspaceHeader } from "@/components/espace/espace-header";
import { Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Miroir de la limite serveur (`validators/settings.js`) : affiché en direct
// pendant la saisie plutôt que découvert seulement à l'enregistrement.
const CONTRACT_TEMPLATE_MAX = 50000;

export function ParametresView() {
  return (
    <RequireAuth roles={["dg"]}>
      <ParametresContent />
    </RequireAuth>
  );
}

function ParametresContent() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = React.useState<TenantSettings | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [template, setTemplate] = React.useState("");
  const [stampFile, setStampFile] = React.useState<File | null>(null);
  const [stampPreview, setStampPreview] = React.useState<string | null>(null);
  const [signatureFile, setSignatureFile] = React.useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = React.useState<string | null>(null);

  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getSettings(accessToken)
      .then((res) => {
        setSettings(res.settings);
        setTemplate(res.settings.contractTemplate ?? "");
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Impossible de charger les paramètres."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

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
    if (!accessToken) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await updateSettings(accessToken, {
        contractTemplate: template,
        stamp: stampFile ?? undefined,
        signature: signatureFile ?? undefined,
      });
      setSettings(res.settings);
      setStampFile(null);
      setSignatureFile(null);
      setSaved(true);
    } catch (err) {
      // Le message générique de l'API ("Formulaire invalide") ne dit pas
      // CE QUI est invalide (ex. texte trop long) : afficher le détail du
      // champ concerné quand il existe, plutôt que de laisser deviner.
      const detail = err instanceof ApiError ? err.details?.contractTemplate?.[0] : undefined;
      setError(detail ?? (err instanceof ApiError ? err.message : "Impossible d'enregistrer les paramètres."));
    } finally {
      setSaving(false);
    }
  }

  function resetToDefault() {
    if (settings) setTemplate("");
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-canvas">
        <EspaceHeader />
        <div className="content-shell py-10">
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="min-h-screen bg-canvas">
        <EspaceHeader />
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  const currentStamp = stampPreview ?? (settings.stampUrl ? `${API_URL}${settings.stampUrl}` : null);
  const currentSignature =
    signaturePreview ?? (settings.signatureUrl ? `${API_URL}${settings.signatureUrl}` : null);

  return (
    <div className="min-h-screen bg-canvas">
      <EspaceHeader />
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour à mon espace
        </Link>

        <div>
          <h1 className="font-display text-headline-xl text-ink">Paramètres</h1>
          <p className="text-body-md text-ink-soft">
            Personnalisez le contrat/l&apos;attestation de loyer généré pour vos locataires.
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
              Paramètres enregistrés.
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Modèle de l&apos;attestation de loyer</CardTitle>
              <CardDescription>
                Rédigez votre propre texte de contrat. La date est toujours ajoutée
                automatiquement au moment de la génération — inutile de la saisir.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {settings.placeholders.map((p) => (
                  <Badge key={p.key} variant="info" className="cursor-default" title={p.label}>
                    {`{{${p.key}}}`}
                  </Badge>
                ))}
              </div>
              <Field
                label="Texte du contrat"
                htmlFor="template"
                hint="Laissez vide pour utiliser le modèle par défaut de Lyko System."
              >
                <textarea
                  id="template"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  placeholder={settings.defaultContractTemplate}
                  rows={18}
                  className="w-full rounded border border-border-strong bg-surface px-3 py-2 font-mono text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </Field>
              <p className={`text-right text-body-xs ${template.length > CONTRACT_TEMPLATE_MAX ? "text-danger-fg" : "text-ink-muted"}`}>
                {template.length.toLocaleString("fr-FR")} / {CONTRACT_TEMPLATE_MAX.toLocaleString("fr-FR")} caractères
              </p>
              {template && (
                <Button type="button" variant="ghost" size="sm" onClick={resetToDefault} className="w-fit">
                  <RotateCcw size={14} />
                  Réinitialiser au modèle par défaut
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Cachet de l&apos;entreprise</CardTitle>
                <CardDescription>Apposé automatiquement sur l&apos;attestation générée.</CardDescription>
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
                  {currentStamp ? "Remplacer le cachet" : "Téléverser un cachet"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleStampChange} className="hidden" />
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Signature</CardTitle>
                <CardDescription>Apposée automatiquement près de « Pour le cabinet, ».</CardDescription>
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
                  {currentSignature ? "Remplacer la signature" : "Téléverser une signature"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSignatureChange} className="hidden" />
                </label>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardFooter className="justify-end">
              <Button type="submit" size="lg" disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer les paramètres"}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </div>
  );
}
