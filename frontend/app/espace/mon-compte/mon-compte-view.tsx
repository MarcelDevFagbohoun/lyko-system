"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Stamp, PenTool, User as UserIcon, Camera, Phone, KeyRound, ChevronRight, Trash2, Undo2, ShieldCheck, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, API_URL } from "@/lib/api/client";
import { RequireAuth } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import { cn } from "@/lib/utils";

/**
 * Mon compte (étape 47, redesign 2026-10-30 — demande utilisateur : « comme pour Google ») : une
 * carte de profil (bandeau + photo qui déborde dessus, à la manière d'une page de compte Google),
 * puis le cachet et la signature personnels apposés sur les quittances des paiements encaissés par
 * l'employé lui-même (à défaut, ceux de l'entreprise s'appliquent — Réglages, DG uniquement), chacun
 * modifiable OU supprimable sans retéléverser (demande utilisateur, 2026-10-30), et l'accès volontaire
 * au changement de mot de passe (jusqu'ici uniquement forcé à la première connexion).
 */
export function MonCompteView() {
  return (
    <RequireAuth>
      <MonCompteContent />
    </RequireAuth>
  );
}

/** Choix + suppression d'une image : `file` (nouvelle, pas encore enregistrée) prévaut sur `removed`
 * (demande de retrait de l'image déjà enregistrée), qui prévaut sur l'image actuellement en base. */
function useImagePicker() {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [removed, setRemoved] = React.useState(false);

  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setRemoved(false);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return picked ? URL.createObjectURL(picked) : null;
    });
    e.target.value = "";
  }, []);

  const remove = React.useCallback(() => {
    setFile(null);
    setRemoved(true);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const reset = React.useCallback(() => {
    setFile(null);
    setRemoved(false);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  return { file, preview, removed, handleChange, remove, reset };
}

type Picker = ReturnType<typeof useImagePicker>;

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
    if (!hasChanges) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateMyProfile({
        avatar: avatar.file ?? undefined,
        stamp: stamp.file ?? undefined,
        signature: signature.file ?? undefined,
        removeAvatar: avatar.removed,
        removeStamp: stamp.removed,
        removeSignature: signature.removed,
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

  const currentAvatar = avatar.preview ?? (!avatar.removed && user.avatarUrl ? `${API_URL}${user.avatarUrl}` : null);
  const currentStamp = stamp.preview ?? (!stamp.removed && user.stampUrl ? `${API_URL}${user.stampUrl}` : null);
  const currentSignature = signature.preview ?? (!signature.removed && user.signatureUrl ? `${API_URL}${user.signatureUrl}` : null);
  const roleLabel = tenant?.roleTitles[user.role] ?? user.role;
  const hasChanges = !!(
    avatar.file || stamp.file || signature.file ||
    (avatar.removed && user.avatarUrl) || (stamp.removed && user.stampUrl) || (signature.removed && user.signatureUrl)
  );

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour à mon espace
        </Link>

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

          {/* Carte de profil : bandeau de couleur + photo qui déborde dessus, nom et poste centrés en
              dessous — mise en page proche d'une page de compte Google. */}
          <Card className="overflow-hidden !p-0">
            <div className="h-20 bg-gradient-to-r from-primary to-primary-hover sm:h-24" />
            <CardContent className="flex flex-col items-center gap-3 px-6 pb-7 pt-0 text-center">
              <div className="relative -mt-12 shrink-0 sm:-mt-14">
                <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-surface bg-surface-muted shadow-sm sm:h-28 sm:w-28">
                  {currentAvatar && accessToken ? (
                    <AuthenticatedImage src={currentAvatar} accessToken={accessToken} alt="Photo de profil" className="h-full w-full object-cover" />
                  ) : (
                    <UserIcon size={36} className="text-ink-faint" />
                  )}
                </div>
                <label className="absolute bottom-0 right-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 border-surface bg-primary text-primary-fg shadow-sm transition hover:bg-primary-hover">
                  <Camera size={16} />
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={avatar.handleChange} className="hidden" />
                </label>
                {(user.avatarUrl && !avatar.removed) || avatar.file ? (
                  <button
                    type="button"
                    onClick={avatar.file ? avatar.reset : avatar.remove}
                    title={avatar.file ? "Annuler" : "Supprimer la photo"}
                    className="absolute bottom-0 left-0 flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface bg-surface text-ink-soft shadow-sm transition hover:text-danger"
                  >
                    {avatar.file ? <Undo2 size={15} /> : <Trash2 size={15} />}
                  </button>
                ) : null}
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <h1 className="font-display text-headline-lg text-ink">
                  {user.firstName} {user.lastName}
                </h1>
                <Badge variant="primary">{roleLabel}</Badge>
                <div className="flex items-center gap-1.5 text-body-sm text-ink-soft">
                  <Phone size={14} />
                  {user.phone}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cachet et signature : liste de deux lignes dans une seule carte (plutôt que deux cartes
              côte à côte) — chacune avec sa miniature, un bouton pour modifier et un pour supprimer. */}
          <Card className="!p-0">
            <div className="divide-y divide-border">
              <SignatureRow
                icon={Stamp}
                title="Mon cachet"
                description="Apposé sur les quittances des paiements que vous encaissez."
                src={currentStamp}
                accessToken={accessToken}
                picker={stamp}
                placeholderIcon={Stamp}
                hasStored={!!user.stampUrl}
              />
              <SignatureRow
                icon={PenTool}
                title="Ma signature"
                description="Apposée près de votre nom sur ces mêmes quittances."
                src={currentSignature}
                accessToken={accessToken}
                picker={signature}
                placeholderIcon={PenTool}
                hasStored={!!user.signatureUrl}
              />
            </div>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={saving || !hasChanges}>
              {saving ? "Enregistrement…" : "Enregistrer les modifications"}
            </Button>
          </div>
        </form>

        <Card className="!p-0">
          <Link
            href="/changer-mot-de-passe"
            className="flex items-center gap-3 px-5 py-4 text-body-sm text-ink hover:bg-surface-muted"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint-slate-bg text-tint-slate-solid">
              <KeyRound size={16} />
            </span>
            <span className="flex flex-1 flex-col">
              <span className="font-label-md text-ink">Changer mon mot de passe</span>
              <span className="flex items-center gap-1 text-body-sm text-ink-muted">
                <ShieldCheck size={13} /> Sécurité du compte
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-ink-faint" />
          </Link>
        </Card>
      </div>
    </div>
  );
}

function SignatureRow({
  icon: Icon,
  title,
  description,
  src,
  accessToken,
  picker,
  placeholderIcon: Placeholder,
  hasStored,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  src: string | null;
  accessToken: string | null;
  picker: Picker;
  placeholderIcon: LucideIcon;
  hasStored: boolean;
}) {
  const canRemove = (hasStored && !picker.removed) || !!picker.file;
  return (
    <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-surface-muted">
        {src && accessToken ? (
          <AuthenticatedImage src={src} accessToken={accessToken} alt={title} className="h-full w-full object-contain p-1.5" />
        ) : (
          <Placeholder size={26} className="text-ink-faint" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 font-label-md text-ink">
          <Icon size={14} className="text-ink-soft" />
          {title}
        </span>
        <span className="text-body-sm text-ink-muted">{description}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
        <label
          className={cn(
            "inline-flex h-9 cursor-pointer items-center rounded border px-3 font-label-sm transition",
            "border-primary-border bg-primary-bg text-primary hover:bg-primary-border/60",
          )}
        >
          {src ? "Remplacer" : "Téléverser"}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={picker.handleChange} className="hidden" />
        </label>
        {picker.file ? (
          <Button type="button" variant="ghost" size="sm" onClick={picker.reset} className="gap-1.5">
            <Undo2 size={14} /> Annuler
          </Button>
        ) : canRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={picker.remove} className="gap-1.5 text-danger-fg hover:bg-danger-bg">
            <Trash2 size={14} /> Supprimer
          </Button>
        ) : null}
      </div>
    </div>
  );
}
