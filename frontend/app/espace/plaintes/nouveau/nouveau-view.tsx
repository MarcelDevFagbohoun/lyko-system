"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ImagePlus, X, CloudOff } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { getRenter, type Lease } from "@/lib/api/renters";
import type { RenterListItem } from "@/lib/api/renters";
import { createComplaint, type ComplaintCategory, type ComplaintPriority } from "@/lib/api/complaints";
import { COMPLAINT_CATEGORY_LABELS } from "@/lib/constants/complaints";
import { RequireAuth } from "@/components/auth/require-auth";
import { EspaceHeader } from "@/components/espace/espace-header";
import { RenterLeasePicker } from "@/components/complaints/renter-lease-picker";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const CATEGORIES = Object.entries(COMPLAINT_CATEGORY_LABELS) as [ComplaintCategory, string][];
const MAX_PHOTOS = 4;

export function NouveauView() {
  return (
    <RequireAuth permission="plaintes">
      <NouveauContent />
    </RequireAuth>
  );
}

function NouveauContent() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const online = useOnlineStatus();
  const searchParams = useSearchParams();
  const prefillRenterId = Number(searchParams.get("renterId"));
  const hasPrefill = Number.isInteger(prefillRenterId) && prefillRenterId > 0;

  // Arrivée depuis la fiche d'un locataire : bail déjà connu, verrouillé.
  const [prefillRenter, setPrefillRenter] = React.useState<{ name: string; lease: Lease } | null>(null);
  const [prefillError, setPrefillError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken || !hasPrefill) return;
    getRenter(accessToken, prefillRenterId)
      .then((res) => {
        const active = res.leases.find((l) => l.status === "active");
        if (!active) throw new ApiError(400, "Ce locataire n'a pas de bail actif.");
        setPrefillRenter({ name: `${res.renter.firstName} ${res.renter.lastName}`, lease: active });
      })
      .catch((err) => setPrefillError(err instanceof ApiError ? err.message : "Impossible de charger ce locataire."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, hasPrefill]);

  const [selectedRenter, setSelectedRenter] = React.useState<RenterListItem | null>(null);
  const leaseId = hasPrefill ? prefillRenter?.lease.id ?? null : selectedRenter?.activeLease?.id ?? null;

  const [category, setCategory] = React.useState<ComplaintCategory>("plomberie");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState<ComplaintPriority>("normale");
  const [reportedAt, setReportedAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !leaseId) return setError("Sélectionnez un locataire avec bail actif.");
    if (title.trim().length < 3) return setError("Titre requis (3 caractères min.).");

    setSubmitting(true);
    setError(null);
    try {
      const res = await createComplaint(accessToken, {
        leaseId,
        category,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        reportedAt,
        photos: online ? photos : [],
      });
      if (res.queued) {
        router.push("/espace/plaintes?queued=1");
      } else {
        router.push(`/espace/plaintes/${res.complaintId}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <EspaceHeader />
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace/plaintes" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour aux plaintes
        </Link>

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Déclarer une plainte / un incident</CardTitle>
            <CardDescription>Un numéro de dossier (INC-{new Date().getFullYear()}-…) est généré automatiquement.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
              {!online && (
                <div className="flex items-center gap-2 rounded-lg border border-warning-border bg-warning/10 px-3 py-2.5 text-body-sm text-warning-fg">
                  <CloudOff size={16} className="shrink-0" />
                  Hors-ligne : cette plainte sera mise en attente et envoyée automatiquement dès le retour de la
                  connexion. Les photos ne peuvent pas être jointes hors-ligne.
                </div>
              )}
              {error && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {error}
                </div>
              )}
              {prefillError && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {prefillError}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <span className="font-label-sm uppercase tracking-wider text-ink-muted">Locataire concerné</span>
                {hasPrefill ? (
                  prefillRenter ? (
                    <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm text-ink">
                      {prefillRenter.name} — {prefillRenter.lease.unit.designationLabel} ({prefillRenter.lease.unit.code})
                    </p>
                  ) : (
                    <p className="text-body-sm text-ink-muted">Chargement…</p>
                  )
                ) : (
                  <RenterLeasePicker
                    accessToken={accessToken}
                    selectedRenterId={selectedRenter?.id ?? null}
                    onSelect={setSelectedRenter}
                  />
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Catégorie" htmlFor="category" required>
                  <select
                    id="category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
                    className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {CATEGORIES.map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Priorité" htmlFor="priority" required>
                  <select
                    id="priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as ComplaintPriority)}
                    className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <option value="normale">Normale</option>
                    <option value="urgente">Urgente</option>
                  </select>
                </Field>
              </div>

              <Field label="Titre" htmlFor="title" required hint="Ex. Fuite robinet cuisine">
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Description (optionnel)" htmlFor="description">
                <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Field label="Date de signalement" htmlFor="reportedAt" required>
                <Input id="reportedAt" type="date" value={reportedAt} onChange={(e) => setReportedAt(e.target.value)} />
              </Field>

              <Field
                label="Photos (optionnel)"
                htmlFor="photos"
                hint={online ? `Jusqu'à ${MAX_PHOTOS} photos, PNG/JPEG/WEBP` : "Indisponible hors-ligne"}
              >
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
                  {online && photos.length < MAX_PHOTOS && (
                    <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-surface-muted text-ink-muted hover:text-ink">
                      <ImagePlus size={20} />
                      <span className="text-body-xs">Ajouter</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={handlePhotosChange} className="hidden" />
                    </label>
                  )}
                </div>
              </Field>

              <Button type="submit" size="lg" disabled={submitting || !leaseId}>
                {submitting
                  ? "Enregistrement…"
                  : !leaseId
                    ? "Sélectionnez un locataire"
                    : online
                      ? "Déclarer la plainte"
                      : "Mettre en attente (hors-ligne)"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
