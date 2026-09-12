"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { createProperty, type PropertyTypeKey } from "@/lib/api/properties";
import type { OwnerListItem } from "@/lib/api/owners";
import { PROPERTY_TYPE_LABELS } from "@/lib/constants/properties";
import { RequireAuth } from "@/components/auth/require-auth";
import { EspaceHeader } from "@/components/espace/espace-header";
import { OwnerPicker } from "@/components/properties/owner-picker";
import { OfflineNotice } from "@/components/system/offline-notice";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const PROPERTY_TYPES = Object.entries(PROPERTY_TYPE_LABELS) as [PropertyTypeKey, string][];
const MAX_PHOTOS = 5;

type FormState = {
  address: string;
  propertyType: PropertyTypeKey;
  levels: string;
};

const INITIAL: FormState = { address: "", propertyType: "villa", levels: "" };

export function NouveauView() {
  return (
    <RequireAuth permission={["locataires", "proprietaires"]}>
      <NouveauContent />
    </RequireAuth>
  );
}

function NouveauContent() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const online = useOnlineStatus();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [selectedOwner, setSelectedOwner] = React.useState<OwnerListItem | null>(null);
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = React.useState<string[]>([]);
  const [touched, setTouched] = React.useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handlePhotosChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS - photos.length);
    setPhotos((prev) => [...prev, ...files].slice(0, MAX_PHOTOS));
    setPhotoPreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))].slice(0, MAX_PHOTOS));
    e.target.value = "";
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  }

  const errors = React.useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (form.levels && (!Number.isInteger(Number(form.levels)) || Number(form.levels) < 1)) {
      e.levels = "Nombre entier requis";
    }
    return e;
  }, [form]);

  const isValid = Object.keys(errors).length === 0 && !!selectedOwner;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ levels: true });
    if (!isValid || !accessToken || !selectedOwner) return;

    setSubmitting(true);
    setServerError(null);
    try {
      const res = await createProperty(accessToken, {
        ownerId: selectedOwner.id,
        address: form.address.trim() || undefined,
        propertyType: form.propertyType,
        levels: form.levels ? Number(form.levels) : undefined,
        photos,
      });
      router.push(`/espace/biens/${res.propertyId}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <EspaceHeader />
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace/biens" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour aux biens
        </Link>

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Nouveau bien</CardTitle>
            <CardDescription>
              Un identifiant (BIEN-001, BIEN-002…) est généré automatiquement. Vous pourrez
              ensuite ajouter ses unités locatives.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
              {!online && <OfflineNotice action="la création d'un bien" />}
              {serverError && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {serverError}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <span className="font-label-sm uppercase tracking-wider text-ink-muted">Propriétaire</span>
                <OwnerPicker accessToken={accessToken} selectedOwner={selectedOwner} onSelect={setSelectedOwner} />
              </div>

              <Field label="Adresse (optionnel)" htmlFor="address">
                <Input id="address" value={form.address} onChange={(e) => set("address", e.target.value)} />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Type de bien" htmlFor="propertyType" required>
                  <select
                    id="propertyType"
                    value={form.propertyType}
                    onChange={(e) => set("propertyType", e.target.value as PropertyTypeKey)}
                    className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {PROPERTY_TYPES.map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Nombre de niveaux (optionnel)" htmlFor="levels" hint="Utile pour villa/duplex" error={touched.levels ? errors.levels : undefined}>
                  <Input id="levels" inputMode="numeric" value={form.levels} onChange={(e) => set("levels", e.target.value.replace(/\D/g, ""))} onBlur={() => setTouched((t) => ({ ...t, levels: true }))} />
                </Field>
              </div>

              <Field label="Photos (optionnel)" htmlFor="photos" hint={`Jusqu'à ${MAX_PHOTOS} photos, PNG/JPEG/WEBP`}>
                <div className="flex flex-wrap gap-3">
                  {photoPreviews.map((src, i) => (
                    <div key={src} className="relative h-20 w-20 overflow-hidden rounded-lg border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-surface-muted text-ink-muted hover:text-ink">
                      <ImagePlus size={20} />
                      <span className="text-body-xs">Ajouter</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={handlePhotosChange} className="hidden" />
                    </label>
                  )}
                </div>
              </Field>

              <Button type="submit" size="lg" disabled={submitting || !selectedOwner || !online}>
                {submitting
                  ? "Création en cours…"
                  : !online
                    ? "Indisponible hors-ligne"
                    : !selectedOwner
                      ? "Sélectionnez un propriétaire"
                      : "Créer le bien"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
