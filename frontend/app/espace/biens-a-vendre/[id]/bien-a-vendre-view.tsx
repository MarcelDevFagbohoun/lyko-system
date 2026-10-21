"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Pencil, X, ImagePlus, Trash2, BadgeCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  getSaleProperty,
  updateSaleProperty,
  addSalePropertyPhotos,
  removeSalePropertyPhoto,
  deleteSaleProperty,
  markSaleSold,
  SALE_PROPERTY_TYPE_LABELS,
  SALE_PROPERTY_STATUS_LABELS,
  SALE_PAYMENT_METHOD_LABELS,
  type SaleProperty,
  type SalePropertyType,
  type SalePropertyStatus,
  type SalePaymentMethod,
} from "@/lib/api/sale-properties";
import { OwnerPicker } from "@/components/properties/owner-picker";
import type { OwnerListItem } from "@/lib/api/owners";
import { formatFcfa } from "@/lib/utils";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { RequireAuth } from "@/components/auth/require-auth";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Attribution } from "@/components/ui/attribution";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";

export function BienAVendreView() {
  return (
    <RequireAuth permission="biens_a_vendre">
      <BienAVendreContent />
    </RequireAuth>
  );
}

const STATUS_BADGE: Record<string, "success" | "warning" | "info" | "neutral" | "danger"> = {
  en_vente: "info",
  en_negociation: "warning",
  vendu: "success",
  retire: "neutral",
};

function BienAVendreContent() {
  const { id } = useParams<{ id: string }>();
  const saleId = Number(id);
  const { accessToken } = useAuth();
  const [item, setItem] = React.useState<SaleProperty | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [markingSold, setMarkingSold] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken || !Number.isInteger(saleId)) return;
    getSaleProperty(accessToken, saleId)
      .then((res) => setItem(res.saleProperty))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Bien à vendre introuvable."));
  }, [accessToken, saleId]);

  React.useEffect(() => load(), [load]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10">
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{loadError}</div>
        </div>
      </div>
    );
  }
  if (!item) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace/biens-a-vendre" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour aux biens à vendre
        </Link>

        {editing ? (
          <EditSalePropertyForm
            item={item}
            accessToken={accessToken}
            onSaved={(updated) => {
              setItem(updated);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle>{item.title}</CardTitle>
                    {item.status !== "vendu" && (
                      <button
                        type="button"
                        onClick={() => setEditing(true)}
                        aria-label="Modifier"
                        className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                  </div>
                  <CardDescription>
                    {item.typeLabel}
                    {item.address ? ` · ${item.address}` : ""}
                    {item.surfaceM2 ? ` · ${item.surfaceM2} m²` : ""}
                  </CardDescription>
                  <Attribution actor={item.createdBy} verb="Ajouté par" at={item.createdAt} className="mt-1 block" />
                  {item.updatedAt && (
                    <Attribution actor={item.updatedBy} verb="Dernière mise à jour par" at={item.updatedAt} className="block" />
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge variant={STATUS_BADGE[item.status] ?? "neutral"}>{SALE_PROPERTY_STATUS_LABELS[item.status]}</Badge>
                  {item.status !== "vendu" && !markingSold && (
                    <Button type="button" onClick={() => setMarkingSold(true)}>
                      <BadgeCheck size={14} />
                      Vendu
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="font-label-sm uppercase tracking-wider text-ink-muted">Prix affiché</p>
                  <p className="tabular font-currency-table text-headline-sm text-ink">{formatFcfa(item.price)}</p>
                </div>
                <div>
                  <p className="font-label-sm uppercase tracking-wider text-ink-muted">Propriétaire</p>
                  <p className="text-body-md text-ink">
                    {item.owner ? `${item.owner.name}${item.owner.phone ? ` · ${item.owner.phone}` : ""}` : "—"}
                  </p>
                </div>
              </div>

              {item.description && (
                <div>
                  <p className="font-label-sm uppercase tracking-wider text-ink-muted">Description</p>
                  <p className="whitespace-pre-wrap text-body-sm text-ink-soft">{item.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {markingSold && (
          <MarkSoldForm
            item={item}
            accessToken={accessToken}
            onSaved={(updated) => {
              setItem(updated);
              setMarkingSold(false);
            }}
            onCancel={() => setMarkingSold(false)}
          />
        )}

        {item.sale && <SaleSummaryCard sale={item.sale} />}

        <PhotosCard item={item} accessToken={accessToken} onChanged={load} />

        <DeleteCard item={item} accessToken={accessToken} onDeleted={() => (window.location.href = "/espace/biens-a-vendre")} />
      </div>
    </div>
  );
}

function EditSalePropertyForm({
  item,
  accessToken,
  onSaved,
  onCancel,
}: {
  item: SaleProperty;
  accessToken: string | null;
  onSaved: (s: SaleProperty) => void;
  onCancel: () => void;
}) {
  const [type, setType] = React.useState<SalePropertyType>(item.type);
  const [title, setTitle] = React.useState(item.title);
  const [address, setAddress] = React.useState(item.address ?? "");
  const [price, setPrice] = React.useState(String(item.price));
  const [surfaceM2, setSurfaceM2] = React.useState(item.surfaceM2 != null ? String(item.surfaceM2) : "");
  const [description, setDescription] = React.useState(item.description ?? "");
  const [status, setStatus] = React.useState<SalePropertyStatus>(item.status);
  const [selectedOwner, setSelectedOwner] = React.useState<OwnerListItem | null>(
    item.owner ? ({ id: item.owner.id, name: item.owner.name, phone: item.owner.phone } as OwnerListItem) : null,
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    const priceNum = Number(price);
    if (!title.trim()) return setError("Titre requis.");
    if (!Number.isFinite(priceNum) || priceNum <= 0) return setError("Prix invalide.");

    setSubmitting(true);
    setError(null);
    try {
      const res = await updateSaleProperty(accessToken, item.id, {
        type,
        title: title.trim(),
        address: address.trim() || undefined,
        price: priceNum,
        surfaceM2: surfaceM2 ? Number(surfaceM2) : undefined,
        description: description.trim() || undefined,
        ownerId: selectedOwner?.id ?? undefined,
        status,
      });
      toast.success("Bien à vendre modifié.");
      onSaved(res.saleProperty);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer les modifications.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Bug corrigé (signalé par l'utilisateur, 2026-10-18) : sans ce z-index explicite, la carte
    // Photos juste en dessous (autre enfant direct du même conteneur flex, elle aussi animée via
    // `Card`) passait par-dessus le menu déroulant du sélecteur de propriétaire — voir le même
    // correctif et son explication complète dans biens-a-vendre-view.tsx.
    <Card className="relative z-10">
      <CardHeader>
        <CardTitle>Modifier {item.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="editType" required>
              <select
                id="editType"
                value={type}
                onChange={(e) => setType(e.target.value as SalePropertyType)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {Object.entries(SALE_PROPERTY_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Statut" htmlFor="editStatus" required>
              <select
                id="editStatus"
                value={status}
                onChange={(e) => setStatus(e.target.value as SalePropertyStatus)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {Object.entries(SALE_PROPERTY_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Titre" htmlFor="editTitle" required>
            <Input id="editTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Prix (FCFA)" htmlFor="editPrice" required>
              <Input id="editPrice" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Surface (m², optionnel)" htmlFor="editSurfaceM2">
              <Input id="editSurfaceM2" inputMode="decimal" value={surfaceM2} onChange={(e) => setSurfaceM2(e.target.value)} />
            </Field>
            <Field label="Adresse (optionnel)" htmlFor="editAddress">
              <Input id="editAddress" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
          </div>
          <Field label="Description (optionnel)" htmlFor="editDescription">
            <textarea
              id="editDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </Field>
          <div>
            <p className="mb-1.5 font-label-sm text-ink-soft">Propriétaire (optionnel)</p>
            <OwnerPicker accessToken={accessToken} selectedOwner={selectedOwner} onSelect={setSelectedOwner} />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Annuler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Bouton « Vendu » (demande utilisateur, 2026-10-18) : prix final (peut différer du prix affiché
 * — « le prix fixé peut s'améliorer »), pourcentage perçu par le cabinet, mode de règlement de
 * cette commission. Le montant de la commission est toujours calculé côté serveur. */
function MarkSoldForm({
  item,
  accessToken,
  onSaved,
  onCancel,
}: {
  item: SaleProperty;
  accessToken: string | null;
  onSaved: (s: SaleProperty) => void;
  onCancel: () => void;
}) {
  const [finalPrice, setFinalPrice] = React.useState(String(item.price));
  const [commissionPercent, setCommissionPercent] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState<SalePaymentMethod>("especes");
  const [soldAt, setSoldAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const { key: idempotencyKey, renew } = useIdempotencyKey();

  const finalPriceNum = Number(finalPrice);
  const commissionPercentNum = Number(commissionPercent);
  const commissionPreview =
    Number.isFinite(finalPriceNum) && Number.isFinite(commissionPercentNum) && finalPriceNum > 0 && commissionPercentNum >= 0
      ? Math.round((finalPriceNum * commissionPercentNum) / 100)
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (!Number.isFinite(finalPriceNum) || finalPriceNum <= 0) return setError("Prix final invalide.");
    if (!Number.isFinite(commissionPercentNum) || commissionPercentNum < 0 || commissionPercentNum > 100) {
      return setError("Pourcentage de commission invalide (0 à 100).");
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await markSaleSold(accessToken, item.id, {
        finalPrice: finalPriceNum,
        commissionPercent: commissionPercentNum,
        paymentMethod,
        soldAt,
        idempotencyKey,
      });
      toast.success("Bien marqué comme vendu.");
      renew();
      onSaved(res.saleProperty);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette vente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="relative z-10 border-success-border">
      <CardHeader>
        <CardTitle>Marquer comme vendu</CardTitle>
        <CardDescription>
          Une fois enregistrée, la vente fige la fiche — plus aucune autre modification n&apos;est possible.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Prix final de vente (FCFA)" htmlFor="soldFinalPrice" required>
              <Input
                id="soldFinalPrice"
                inputMode="numeric"
                value={finalPrice}
                onChange={(e) => setFinalPrice(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Commission perçue (%)" htmlFor="soldCommissionPercent" required>
              <Input
                id="soldCommissionPercent"
                inputMode="decimal"
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(e.target.value)}
                placeholder="Ex. 5"
              />
            </Field>
            <Field label="Date de la vente" htmlFor="soldAt" required>
              <Input id="soldAt" type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Mode de règlement de la commission" htmlFor="soldPaymentMethod" required>
            <select
              id="soldPaymentMethod"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as SalePaymentMethod)}
              className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {Object.entries(SALE_PAYMENT_METHOD_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {commissionPreview != null && (
            <p className="text-body-sm text-ink-muted">
              Commission du cabinet : <span className="tabular font-currency-table text-ink">{formatFcfa(commissionPreview)}</span>
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Enregistrement…" : "Confirmer la vente"}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Annuler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SaleSummaryCard({ sale }: { sale: NonNullable<SaleProperty["sale"]> }) {
  return (
    <Card className="border-success-border">
      <CardHeader>
        <CardTitle>Vente</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="font-label-sm uppercase tracking-wider text-ink-muted">Prix final</p>
            <p className="tabular font-currency-table text-headline-sm text-ink">{formatFcfa(sale.finalPrice)}</p>
          </div>
          <div>
            <p className="font-label-sm uppercase tracking-wider text-ink-muted">Commission du cabinet</p>
            <p className="tabular font-currency-table text-headline-sm text-ink">
              {formatFcfa(sale.commissionAmount)} <span className="text-body-sm text-ink-muted">({sale.commissionPercent}%)</span>
            </p>
          </div>
          <div>
            <p className="font-label-sm uppercase tracking-wider text-ink-muted">Réglée par</p>
            <p className="text-body-md text-ink">{SALE_PAYMENT_METHOD_LABELS[sale.paymentMethod]}</p>
          </div>
        </div>
        <Attribution actor={sale.soldBy} verb="Vente enregistrée par" at={sale.soldAt} className="mt-3 block" />
      </CardContent>
    </Card>
  );
}

function PhotosCard({
  item,
  accessToken,
  onChanged,
}: {
  item: SaleProperty;
  accessToken: string | null;
  onChanged: () => void;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!accessToken || !files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await addSalePropertyPhotos(accessToken, item.id, Array.from(files));
      toast.success("Photo(s) ajoutée(s).");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ajouter ces photos.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemove(index: number) {
    if (!accessToken) return;
    try {
      await removeSalePropertyPhoto(accessToken, item.id, index);
      toast.success("Photo retirée.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de retirer cette photo.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Photos</CardTitle>
        <CardDescription>Jusqu&apos;à 6 photos — ajoutées/retirées une par une.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {item.photoUrls.map((url, index) => (
            <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
              {accessToken && <AuthenticatedImage src={url} accessToken={accessToken} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />}
              <button
                type="button"
                onClick={() => handleRemove(index)}
                aria-label="Retirer cette photo"
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-ink/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {item.photoUrls.length < 6 && (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong text-ink-muted hover:border-primary hover:text-primary">
              <ImagePlus size={20} />
              <span className="text-body-xs">{uploading ? "Envoi…" : "Ajouter"}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                disabled={uploading}
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </label>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteCard({
  item,
  accessToken,
  onDeleted,
}: {
  item: SaleProperty;
  accessToken: string | null;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteSaleProperty(accessToken, item.id, reason.trim());
      toast.success("Fiche supprimée.");
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de supprimer cette fiche.");
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="sm" className="w-fit text-danger-fg" onClick={() => setConfirming(true)}>
        <Trash2 size={15} />
        Supprimer cette fiche
      </Button>
    );
  }

  return (
    <Card className="border-danger-border">
      <CardHeader>
        <CardTitle>Supprimer cette fiche ?</CardTitle>
        <CardDescription>Réservé à une fiche créée par erreur — la trace reste en base, jamais effacée.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleDelete} className="flex flex-col gap-3">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <Field label="Motif" htmlFor="deleteReason" required>
            <Input id="deleteReason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. Doublon de saisie" />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="destructive" disabled={submitting || reason.trim().length < 5}>
              {submitting ? "Suppression…" : "Confirmer la suppression"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={submitting}>
              Annuler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
