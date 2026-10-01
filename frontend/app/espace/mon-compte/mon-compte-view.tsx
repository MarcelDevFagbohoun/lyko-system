"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Stamp, PenTool, User as UserIcon, Camera, Phone, KeyRound, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, API_URL } from "@/lib/api/client";
import { RequireAuth } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";

/**
 * Mon compte (étape 47) : identité (photo, nom, poste, téléphone), cachet/
 * signature personnels apposés sur les quittances des paiements encaissés
 * par l'employé lui-même (à défaut, ceux de l'entreprise s'appliquent —
 * Réglages, DG uniquement), et accès volontaire au changement de mot de
 * passe (jusqu'ici uniquement forcé à la première connexion).
 */
export function MonCompteView() {
  return (
    <RequireAuth>
      <MonCompteContent />
    </RequireAuth>
  );
}

function useImagePicker() {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);

  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return picked ? URL.createObjectURL(picked) : null;
    });
    e.target.value = "";
  }, []);

  const reset = React.useCallback(() => {
    setFile(null);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  return { file, preview, handleChange, reset };
}

function MonCompteContent() {
  const { user, tenant, accessToken, updateMyProfile } = useAuth();
  const avatar = useImagePicker();
  const stamp = useImagePicker();
  const signature = useImagePicker();

  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!avatar.file && !stamp.file && !signature.file) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateMyProfile({
        avatar: avatar.file ?? undefined,
        stamp: stamp.file ?? undefined,
        signature: signature.file ?? undefined,
      });
      avatar.reset();
      stamp.reset();
      signature.reset();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer les modifications.");
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

  const currentAvatar = avatar.preview ?? (user.avatarUrl ? `${API_URL}${user.avatarUrl}` : null);
  const currentStamp = stamp.preview ?? (user.stampUrl ? `${API_URL}${user.stampUrl}` : null);
  const currentSignature = signature.preview ?? (user.signatureUrl ? `${API_URL}${user.signatureUrl}` : null);
  const roleLabel = tenant?.roleTitles[user.role] ?? user.role;
  const hasChanges = !!(avatar.file || stamp.file || signature.file);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour à mon espace
        </Link>

        <div>
          <h1 className="font-display text-headline-xl text-ink">Mon compte</h1>
          <p className="text-body-md text-ink-soft">Votre identité, votre cachet et votre signature, et l&apos;accès à votre mot de passe.</p>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-6">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}
          {saved && (
            <div className="rounded-lg border border-success-border bg-success-bg px-3 py-2 text-body-sm text-success-fg">
              Modifications enregistrées.
            </div>
          )}

          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-6 text-center sm:flex-row sm:items-center sm:text-left">
              <div className="relative shrink-0">
                <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-muted">
                  {currentAvatar && accessToken ? (
                    <AuthenticatedImage
                      src={currentAvatar}
                      accessToken={accessToken}
                      alt="Photo de profil"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <UserIcon size={36} className="text-ink-faint" />
                  )}
                </div>
                <label className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-ink-soft shadow-sm hover:text-primary">
                  <Camera size={16} />
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={avatar.handleChange} className="hidden" />
                </label>
              </div>
              <div className="flex flex-col items-center gap-1.5 sm:items-start">
                <h2 className="font-display text-headline-md text-ink">
                  {user.firstName} {user.lastName}
                </h2>
                <Badge variant="primary">{roleLabel}</Badge>
                <div className="flex items-center gap-1.5 text-body-sm text-ink-soft">
                  <Phone size={14} />
                  {user.phone}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Mon cachet</CardTitle>
                <CardDescription>Apposé sur les quittances des paiements que vous encaissez.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted">
                  {currentStamp && accessToken ? (
                    <AuthenticatedImage
                      src={currentStamp}
                      accessToken={accessToken}
                      alt="Cachet"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <Stamp size={28} className="text-ink-faint" />
                  )}
                </div>
                <label className="cursor-pointer font-label-sm text-primary hover:underline">
                  {currentStamp ? "Remplacer mon cachet" : "Téléverser mon cachet"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={stamp.handleChange} className="hidden" />
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
                  {currentSignature && accessToken ? (
                    <AuthenticatedImage
                      src={currentSignature}
                      accessToken={accessToken}
                      alt="Signature"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <PenTool size={28} className="text-ink-faint" />
                  )}
                </div>
                <label className="cursor-pointer font-label-sm text-primary hover:underline">
                  {currentSignature ? "Remplacer ma signature" : "Téléverser ma signature"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={signature.handleChange} className="hidden" />
                </label>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardFooter className="justify-end">
              <Button type="submit" size="lg" disabled={saving || !hasChanges}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </CardFooter>
          </Card>
        </form>

        <Card>
          <CardHeader>
            <CardTitle>Sécurité</CardTitle>
            <CardDescription>Le mot de passe utilisé pour vous connecter à votre espace.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/changer-mot-de-passe"
              className="flex items-center justify-between rounded-lg border border-border bg-surface-muted px-4 py-3 text-body-sm text-ink hover:bg-surface"
            >
              <span className="flex items-center gap-2">
                <KeyRound size={16} className="text-ink-soft" />
                Changer mon mot de passe
              </span>
              <ChevronRight size={16} className="text-ink-faint" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
