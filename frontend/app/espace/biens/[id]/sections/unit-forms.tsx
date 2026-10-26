"use client";

import * as React from "react";
import { DoorOpen, Store, Pencil } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  createUnit,
  updateUnit,
  releaseUnit,
  getPropertiesMeta,
  type Unit,
  type UnitDesignationKey,
  type CatalogEntry,
} from "@/lib/api/properties";
import { publishListing } from "@/lib/api/marketplace";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";
import { warnIfMeterNumberLengthUnusual } from "./shared";

/** Action « le locataire a quitté » : termine le bail actif et remet l'unité « Libre ». */
export function ReleaseUnitAction({
  propertyId,
  unit,
  accessToken,
  onReleased,
}: {
  propertyId: number;
  unit: Unit;
  accessToken: string | null;
  onReleased: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleRelease() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await releaseUnit(accessToken, propertyId, unit.id);
      onReleased();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de libérer cette unité.");
      setSubmitting(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <span className="text-body-xs text-danger-fg">Confirmer ?</span>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={submitting}>
          Non
        </Button>
        <Button variant="destructive" size="sm" onClick={handleRelease} disabled={submitting}>
          {submitting ? "…" : "Oui"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error && <span className="text-body-xs text-danger-fg">{error}</span>}
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <DoorOpen size={14} />
        Locataire parti — libérer
      </Button>
    </div>
  );
}

/**
 * Marketplace (demande directe de l'utilisateur) : publier une Unité
 * vacante en une seule action. Le panneau flotte au-dessus du tableau
 * (`absolute`) plutôt que de s'insérer dans la ligne — une cellule de
 * tableau ne peut pas accueillir un textarea + un champ fichier sans
 * casser la mise en page des colonnes voisines.
 */
/**
 * Marketplace (demande directe de l'utilisateur) : publier une Unité
 * vacante en une seule action. Rendu comme une Card à part, EN DEHORS du
 * tableau des unités (jamais en `absolute` dans une cellule) — le
 * conteneur du tableau est `overflow-x-auto`, ce qui force aussi
 * `overflow-y` à se comporter en `auto` (règle CSS : un axe non-`visible`
 * force l'autre à quitter `visible`), un panneau plus haut que la ligne
 * s'y retrouverait tronqué avec un défilement interne peu visible.
 */
export function PublishListingForm({
  unit,
  accessToken,
  onCancel,
  onPublished,
}: {
  unit: Unit;
  accessToken: string | null;
  onCancel: () => void;
  onPublished: () => void;
}) {
  const [description, setDescription] = React.useState("");
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handlePublish() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await publishListing(accessToken, unit.id, { description: description || undefined, photos });
      toast.success(`Unité ${unit.code} publiée sur la marketplace.`);
      onPublished();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de publier cette annonce.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <Store size={16} />
            Publier {unit.code} sur la marketplace
          </span>
        </CardTitle>
        <CardDescription>Description et photos (optionnelles) — visibles sur la page publique.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Description de l'annonce (optionnel)"
          className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 6))}
          className="text-body-sm text-ink-soft"
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Annuler
          </Button>
          <Button variant="primary" size="sm" onClick={handlePublish} disabled={submitting}>
            {submitting ? "Publication…" : "Publier"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function EditUnitForm({
  propertyId,
  unit,
  accessToken,
  onCancel,
  onSaved,
}: {
  propertyId: number;
  unit: Unit;
  accessToken: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [designations, setDesignations] = React.useState<CatalogEntry<UnitDesignationKey>[]>([]);
  const [designation, setDesignation] = React.useState<UnitDesignationKey>(unit.designation);
  const [designationCustom, setDesignationCustom] = React.useState(unit.designationCustom ?? "");
  const [monthlyRent, setMonthlyRent] = React.useState(String(unit.monthlyRent));
  const [sonebMeterNumber, setSonebMeterNumber] = React.useState(unit.sonebMeterNumber ?? "");
  const [sbeeMeterNumber, setSbeeMeterNumber] = React.useState(unit.sbeeMeterNumber ?? "");
  const [furnished, setFurnished] = React.useState(unit.furnished);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (!accessToken) return;
    getPropertiesMeta(accessToken).then((res) => setDesignations(res.unitDesignations));
  }, [accessToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    warnIfMeterNumberLengthUnusual(toast, "SONEB", sonebMeterNumber);
    warnIfMeterNumberLengthUnusual(toast, "SBEE", sbeeMeterNumber);
    try {
      await updateUnit(accessToken, propertyId, unit.id, {
        designation,
        designationCustom: designation === "autre" ? designationCustom.trim() : undefined,
        monthlyRent: Number(monthlyRent),
        sonebMeterNumber: sonebMeterNumber.trim() || undefined,
        sbeeMeterNumber: sbeeMeterNumber.trim() || undefined,
        furnished,
      });
      toast.success(`Unité ${unit.code} modifiée.`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de modifier cette unité.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <Pencil size={16} />
            Modifier {unit.code}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Désignation" htmlFor="editDesignation" required>
              <select
                id="editDesignation"
                value={designation}
                onChange={(e) => setDesignation(e.target.value as UnitDesignationKey)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {designations.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Loyer mensuel (FCFA)" htmlFor="editMonthlyRent" required>
              <Input
                id="editMonthlyRent"
                inputMode="numeric"
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>

          {designation === "autre" && (
            <Field label="Précisez la désignation" htmlFor="editDesignationCustom" required>
              <Input id="editDesignationCustom" value={designationCustom} onChange={(e) => setDesignationCustom(e.target.value)} />
            </Field>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="N° compteur SONEB (optionnel)" htmlFor="editSoneb">
              <Input id="editSoneb" value={sonebMeterNumber} onChange={(e) => setSonebMeterNumber(e.target.value)} />
            </Field>
            <Field label="N° compteur SBEE (optionnel)" htmlFor="editSbee">
              <Input id="editSbee" value={sbeeMeterNumber} onChange={(e) => setSbeeMeterNumber(e.target.value)} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-body-sm text-ink-soft">
            <input
              type="checkbox"
              checked={furnished}
              onChange={(e) => setFurnished(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong text-primary"
            />
            Meublé
          </label>

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

export function NewUnitForm({
  propertyId,
  accessToken,
  onCreated,
}: {
  propertyId: number;
  accessToken: string | null;
  onCreated: () => void;
}) {
  const [designations, setDesignations] = React.useState<CatalogEntry<UnitDesignationKey>[]>([]);
  const [designation, setDesignation] = React.useState<UnitDesignationKey>("studio");
  const [designationCustom, setDesignationCustom] = React.useState("");
  const [monthlyRent, setMonthlyRent] = React.useState("");
  const [sonebMeterNumber, setSonebMeterNumber] = React.useState("");
  const [sbeeMeterNumber, setSbeeMeterNumber] = React.useState("");
  const [furnished, setFurnished] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (!accessToken) return;
    getPropertiesMeta(accessToken).then((res) => setDesignations(res.unitDesignations));
  }, [accessToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    warnIfMeterNumberLengthUnusual(toast, "SONEB", sonebMeterNumber);
    warnIfMeterNumberLengthUnusual(toast, "SBEE", sbeeMeterNumber);
    try {
      const res = await createUnit(accessToken, propertyId, {
        designation,
        designationCustom: designation === "autre" ? designationCustom.trim() : undefined,
        monthlyRent: Number(monthlyRent),
        sonebMeterNumber: sonebMeterNumber.trim() || undefined,
        sbeeMeterNumber: sbeeMeterNumber.trim() || undefined,
        furnished,
      });
      onCreated();
      toast.success(`Unité ${res.code} créée.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer cette unité.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Désignation" htmlFor="designation" required>
              <select
                id="designation"
                value={designation}
                onChange={(e) => setDesignation(e.target.value as UnitDesignationKey)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {designations.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Loyer mensuel (FCFA)" htmlFor="monthlyRent" required>
              <Input id="monthlyRent" inputMode="numeric" value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>

          {designation === "autre" && (
            <Field label="Précisez la désignation" htmlFor="designationCustom" required>
              <Input id="designationCustom" value={designationCustom} onChange={(e) => setDesignationCustom(e.target.value)} />
            </Field>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="N° compteur SONEB (optionnel)" htmlFor="soneb">
              <Input id="soneb" value={sonebMeterNumber} onChange={(e) => setSonebMeterNumber(e.target.value)} />
            </Field>
            <Field label="N° compteur SBEE (optionnel)" htmlFor="sbee">
              <Input id="sbee" value={sbeeMeterNumber} onChange={(e) => setSbeeMeterNumber(e.target.value)} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-body-sm text-ink-soft">
            <input type="checkbox" checked={furnished} onChange={(e) => setFurnished(e.target.checked)} className="h-4 w-4 rounded border-border-strong text-primary" />
            Meublé
          </label>

          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Création…" : "Ajouter l'unité"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
