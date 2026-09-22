"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Phone, MapPin, Layers, DoorOpen, Check, Gauge, Receipt, Store, UserCog, UserX } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { API_URL } from "@/lib/api/client";
import { ApiError } from "@/lib/api/client";
import {
  getProperty,
  createUnit,
  releaseUnit,
  updateProperty,
  getPropertiesMeta,
  getPropertyRecette,
  type Property,
  type Unit,
  type UnitDesignationKey,
  type CatalogEntry,
  type PropertyRecette,
} from "@/lib/api/properties";
import { listEmployees, assignProperties, unassignProperty, type Employee } from "@/lib/api/employees";
import { updatePropertyUtilityConfig, type UtilityConfigInput } from "@/lib/api/charges";
import { publishListing } from "@/lib/api/marketplace";
import { UTILITY_TYPE_LABELS, LOSS_ALLOCATION_LABELS } from "@/lib/constants/charges";
import { createExpense, type ExpenseCategory } from "@/lib/api/accounting";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants/expenses";
import type { PaymentMethod } from "@/lib/api/renters";
import { PROPERTY_TYPE_LABELS, unitDesignationLabel } from "@/lib/constants/properties";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Attribution } from "@/components/ui/attribution";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";

const LocationPicker = dynamic(() => import("@/components/properties/location-picker"), {
  ssr: false,
  loading: () => <div className="flex h-[280px] items-center justify-center rounded-lg border border-border-strong bg-surface-muted text-body-sm text-ink-muted">Chargement de la carte…</div>,
});

const UNIT_STATUS_BADGE = {
  libre: { variant: "success" as const, label: "Libre" },
  loue: { variant: "neutral" as const, label: "Loué" },
  reserve: { variant: "warning" as const, label: "Réservé" },
};

export function BienView() {
  return (
    <RequireAuth permission={["locataires", "proprietaires"]}>
      <BienContent />
    </RequireAuth>
  );
}

function BienContent() {
  const { id } = useParams<{ id: string }>();
  const propertyId = Number(id);
  const { accessToken, user } = useAuth();
  // Recette/commission : donnée financière sensible, réservée à
  // proprietaires/comptabilite (même règle que côté serveur) — pas un agent
  // qui n'a que `locataires`, bien qu'il puisse consulter le reste de la fiche.
  const canReadRecette =
    user?.role === "dg" ||
    (user?.permissions.includes("proprietaires") ?? false) ||
    (user?.permissions.includes("comptabilite") ?? false);
  // Créer une dépense : strictement réservé à comptabilite (même règle que
  // côté serveur, `requirePermission('comptabilite')`) — proprietaires seul
  // peut lire la recette mais pas ajouter une écriture financière.
  const canManageExpenses = user?.role === "dg" || (user?.permissions.includes("comptabilite") ?? false);

  const [property, setProperty] = React.useState<Property | null>(null);
  const [units, setUnits] = React.useState<Unit[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [showUnitForm, setShowUnitForm] = React.useState(false);
  const [justFreed, setJustFreed] = React.useState<string | null>(null);
  const [publishingUnit, setPublishingUnit] = React.useState<Unit | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken || !Number.isInteger(propertyId)) return;
    getProperty(accessToken, propertyId)
      .then((res) => {
        setProperty(res.property);
        setUnits(res.units);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Bien introuvable."));
  }, [accessToken, propertyId]);

  React.useEffect(() => load(), [load]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10">
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (!property || !units) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace/biens" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour aux biens
        </Link>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>{property.code}</CardTitle>
              <Badge variant="neutral">{PROPERTY_TYPE_LABELS[property.type]}</Badge>
              {/* Agent responsable (étape 14) : attribution gérée depuis la fiche de
                  l'employé — affichage seul ici. Aucun badge si non attribué : tout
                  agent sans aucune attribution garde de toute façon accès complet. */}
              {property.agent && (
                <Badge variant="info">Géré par {property.agent.name}</Badge>
              )}
            </div>
            <CardDescription>
              Propriétaire :{" "}
              <Link href={`/espace/proprietaires/${property.owner.id}`} className="text-primary hover:underline">
                {property.owner.name}
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-4 text-body-sm text-ink-soft">
              {property.owner.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone size={14} className="text-ink-muted" /> {property.owner.phone}
                </span>
              )}
              {property.address && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} className="text-ink-muted" /> {property.address}
                </span>
              )}
              {property.levels && (
                <span className="inline-flex items-center gap-1.5">
                  <Layers size={14} className="text-ink-muted" /> {property.levels} niveau{property.levels > 1 ? "x" : ""}
                </span>
              )}
            </div>
            <Attribution actor={property.createdBy} verb="Bien créé par" at={property.createdAt} />

            {property.photoUrls.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {property.photoUrls.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={`${API_URL}${url}`}
                    alt={property.code}
                    className="h-24 w-24 rounded-lg border border-border object-cover"
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <LocationCard property={property} accessToken={accessToken} onSaved={load} />

        <UtilityConfigCard property={property} accessToken={accessToken} onSaved={load} />

        {user?.role === "dg" && (
          <AgentAssignmentCard property={property} accessToken={accessToken} onSaved={load} />
        )}

        {canReadRecette && (
          <RecetteCard
            propertyId={propertyId}
            units={units}
            canManage={canManageExpenses}
            accessToken={accessToken}
          />
        )}

        <div className="flex items-center justify-between">
          <h2 className="font-display text-headline-md text-ink">Unités locatives</h2>
          <Button size="sm" onClick={() => setShowUnitForm((v) => !v)}>
            <Plus size={16} />
            {showUnitForm ? "Fermer" : "Ajouter une unité"}
          </Button>
        </div>

        {justFreed && (
          <div className="flex items-center gap-2 rounded-lg border border-success-border bg-success-bg px-3 py-2 text-body-sm text-success-fg">
            <Check size={16} />
            L&apos;unité {justFreed} est maintenant libre.
          </div>
        )}

        {showUnitForm && (
          <NewUnitForm
            propertyId={propertyId}
            accessToken={accessToken}
            onCreated={() => {
              setShowUnitForm(false);
              load();
            }}
          />
        )}

        {units.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-body-sm text-ink-muted">
              Aucune unité pour ce bien. Ajoutez-en une pour pouvoir y loger un locataire.
            </CardContent>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Unité</TableHead>
                <TableHead>Désignation</TableHead>
                <TableHead className="text-right">Loyer</TableHead>
                <TableHead className="text-center">Statut</TableHead>
                <TableHead>Locataire actuel</TableHead>
                <TableHead>Compteurs</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {units.map((u) => {
                const badge = UNIT_STATUS_BADGE[u.status];
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-label-md text-ink">{u.code}</TableCell>
                    <TableCell className="text-ink-soft">
                      {unitDesignationLabel(u.designation, u.designationCustom)}
                      {u.furnished && <Badge variant="info" className="ml-2 text-[10px]">Meublé</Badge>}
                    </TableCell>
                    <TableAmount>{formatFcfa(u.monthlyRent)}</TableAmount>
                    <TableCell className="text-center">
                      <Badge variant={badge.variant} dot>
                        {badge.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-ink-soft">
                      {u.currentRenter ? (
                        <Link href={`/espace/locataires/${u.currentRenter.id}`} className="text-primary hover:underline">
                          {u.currentRenter.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-body-xs text-ink-muted">
                      {u.sonebMeterNumber && <div>SONEB : {u.sonebMeterNumber}</div>}
                      {u.sbeeMeterNumber && <div>SBEE : {u.sbeeMeterNumber}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {u.status !== "libre" ? (
                        <ReleaseUnitAction
                          propertyId={propertyId}
                          unit={u}
                          accessToken={accessToken}
                          onReleased={() => {
                            setJustFreed(u.code);
                            load();
                          }}
                        />
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setPublishingUnit(u)}>
                          <Store size={14} />
                          Publier
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {publishingUnit && (
          <PublishListingForm
            unit={publishingUnit}
            accessToken={accessToken}
            onCancel={() => setPublishingUnit(null)}
            onPublished={() => {
              setPublishingUnit(null);
              load();
            }}
          />
        )}
      </div>
    </div>
  );
}

const EXPENSE_PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

/**
 * Recette nette de ce Bien pour un mois choisi, et sa répartition
 * cabinet/propriétaire selon le taux de commission en vigueur ce mois-là
 * (calculé côté serveur — voir `services/commission.js`). Purement informatif
 * : ne crée aucune écriture, le versement au propriétaire reste manuel.
 *
 * Inclut aussi la saisie d'une dépense rattachée à ce Bien (et
 * optionnellement à une Unité précise) — jusqu'ici seule une dépense de
 * fonctionnement du cabinet (sans Bien) pouvait être saisie, depuis
 * Comptabilité. La recette se recalcule automatiquement après enregistrement.
 */
function RecetteCard({
  propertyId,
  units,
  canManage,
  accessToken,
}: {
  propertyId: number;
  units: Unit[];
  canManage: boolean;
  accessToken: string | null;
}) {
  const [month, setMonth] = React.useState(new Date().toISOString().slice(0, 7));
  const [recette, setRecette] = React.useState<PropertyRecette | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [showExpenseForm, setShowExpenseForm] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken || !month) return;
    setLoading(true);
    setError(null);
    getPropertyRecette(accessToken, propertyId, month)
      .then((res) => setRecette(res.recette))
      .catch((err) => {
        setRecette(null);
        setError(err instanceof ApiError ? err.message : "Impossible de calculer la recette de ce mois.");
      })
      .finally(() => setLoading(false));
  }, [accessToken, propertyId, month, refreshKey]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Recette du mois</CardTitle>
            <CardDescription>Loyers encaissés, dépenses rattachées à ce Bien, part cabinet / propriétaire.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            {canManage && (
              <Button variant="info" size="sm" onClick={() => setShowExpenseForm((v) => !v)}>
                <Receipt size={14} />
                {showExpenseForm ? "Fermer" : "Nouvelle dépense"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {showExpenseForm && canManage && (
          <NewPropertyExpenseForm
            propertyId={propertyId}
            units={units}
            accessToken={accessToken}
            onRecorded={() => {
              setShowExpenseForm(false);
              setRefreshKey((k) => k + 1);
            }}
          />
        )}

        {loading && <p className="text-body-sm text-ink-muted">Calcul…</p>}
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {recette && !loading && (
          <>
            {!recette.rateDefined && (
              <div className="rounded-lg border border-warning-border bg-warning/10 px-3 py-2.5 text-body-sm text-warning-fg">
                Aucun taux de commission défini pour ce propriétaire — 0 % appliqué par défaut.{" "}
                <Link href={`/espace/proprietaires/${recette.ownerId}`} className="underline hover:no-underline">
                  Définir un taux
                </Link>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard label="Loyers encaissés" value={formatFcfa(recette.totalPayments, { withSuffix: false })} unit="FCFA" tone="success" />
              <StatCard label="Dépenses rattachées" value={formatFcfa(recette.totalExpenses, { withSuffix: false })} unit="FCFA" tone={recette.totalExpenses > 0 ? "warning" : "default"} />
              <StatCard label="Recette nette" value={formatFcfa(recette.recetteNette, { withSuffix: false })} unit="FCFA" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatCard
                label={`Commission cabinet (${recette.rate} %)`}
                value={formatFcfa(recette.commissionCabinet, { withSuffix: false })}
                unit="FCFA"
                tone="info"
              />
              <StatCard label="Part propriétaire" value={formatFcfa(recette.partProprietaire, { withSuffix: false })} unit="FCFA" tone="success" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Saisie d'une dépense rattachée à ce Bien — et, si une Unité précise est
 * choisie, à cette Unité (ex. réparation d'une seule chambre). `propertyId`
 * est fixé par le contexte (fiche du Bien) : pas de sélecteur à ce niveau,
 * contrairement au formulaire général de Comptabilité.
 */
function NewPropertyExpenseForm({
  propertyId,
  units,
  accessToken,
  onRecorded,
}: {
  propertyId: number;
  units: Unit[];
  accessToken: string | null;
  onRecorded: () => void;
}) {
  const [category, setCategory] = React.useState<ExpenseCategory>("entretien");
  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [expenseDate, setExpenseDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = React.useState<PaymentMethod>("especes");
  const [unitId, setUnitId] = React.useState<string>(""); // "" = tout le Bien
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (!label.trim()) return setError("Libellé requis.");
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError("Montant invalide.");
    setSubmitting(true);
    setError(null);
    try {
      await createExpense(accessToken, {
        category,
        label: label.trim(),
        amount: n,
        expenseDate,
        paymentMethod: method,
        notes: notes.trim() || undefined,
        propertyId,
        unitId: unitId ? Number(unitId) : undefined,
      });
      onRecorded();
      toast.success("Dépense enregistrée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette dépense.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Libellé" htmlFor="propExpLabel" required hint="Ex. Réparation robinetterie">
          <Input id="propExpLabel" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Montant (FCFA)" htmlFor="propExpAmount" required>
          <Input id="propExpAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Unité concernée (optionnel)" htmlFor="propExpUnit" hint="Laisser vide si ça concerne tout le Bien">
          <select
            id="propExpUnit"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">Tout le Bien</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.code}</option>
            ))}
          </select>
        </Field>
        <Field label="Catégorie" htmlFor="propExpCategory" required>
          <select
            id="propExpCategory"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {Object.entries(EXPENSE_CATEGORY_LABELS).map(([key, l]) => (
              <option key={key} value={key}>{l}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" htmlFor="propExpDate" required>
          <Input id="propExpDate" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
        </Field>
        <Field label="Mode de règlement" htmlFor="propExpMethod" required>
          <select
            id="propExpMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {EXPENSE_PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Note (optionnel)" htmlFor="propExpNotes">
        <Input id="propExpNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Button type="submit" disabled={submitting} className="self-start">
        {submitting ? "Enregistrement…" : "Enregistrer la dépense"}
      </Button>
    </form>
  );
}

/**
 * Repère GPS du Bien (étape 13, idée n°10 : carte du portefeuille) — placé à
 * la main sur une carte (jamais géocodé depuis l'adresse texte libre, trop
 * imprécise au Bénin). Permet de retrouver ce Bien sur « Nos biens » → Carte.
 */
function LocationCard({
  property,
  accessToken,
  onSaved,
}: {
  property: Property;
  accessToken: string | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [coords, setCoords] = React.useState<{ lat: number; lng: number } | null>(
    property.latitude != null && property.longitude != null
      ? { lat: property.latitude, lng: property.longitude }
      : null,
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setCoords(
      property.latitude != null && property.longitude != null
        ? { lat: property.latitude, lng: property.longitude }
        : null,
    );
  }, [property.latitude, property.longitude]);

  const toast = useToast();

  async function handleSave() {
    if (!accessToken || !coords) return;
    setSaving(true);
    setError(null);
    try {
      await updateProperty(accessToken, property.id, { latitude: coords.lat, longitude: coords.lng });
      setEditing(false);
      onSaved();
      toast.success("Repère enregistré.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-ink-muted" />
            <CardTitle>Localisation</CardTitle>
          </div>
          {!editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {property.latitude != null ? "Modifier" : "Placer sur la carte"}
            </Button>
          )}
        </div>
        <CardDescription>Repère utilisé par la carte du portefeuille (« Nos biens » → Carte).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {!editing ? (
          property.latitude != null && property.longitude != null ? (
            <div>
              <p className="text-body-sm text-ink">
                {property.address || "Adresse non renseignée"}
              </p>
              <p className="text-body-xs text-ink-muted">
                {property.latitude.toFixed(5)}, {property.longitude.toFixed(5)}
              </p>
              {property.locationSetAt && (
                <p className="text-body-xs text-ink-faint">
                  Repère placé le {new Date(property.locationSetAt).toLocaleDateString("fr-FR")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-body-sm text-ink-muted">Aucun repère placé pour ce bien.</p>
          )
        ) : (
          <>
            <LocationPicker
              latitude={coords?.lat ?? null}
              longitude={coords?.lng ?? null}
              onChange={(lat, lng) => setCoords({ lat, lng })}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving || !coords}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Annuler
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Section « Compteurs & fluides » — configuration du sous-comptage SONEB/SBEE
 * par immeuble (étape 9bis) : active/désactive, tarif au m³/kWh, n° du
 * compteur principal. Sert de base au relevé mensuel par immeuble.
 */
function UtilityConfigCard({
  property,
  accessToken,
  onSaved,
}: {
  property: Property;
  accessToken: string | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  const cfg = property.utilityConfig;
  const anySubmetered = cfg.soneb.submetered || cfg.sbee.submetered;

  const [form, setForm] = React.useState<Record<string, string>>(() => ({
    sonebSubmetered: cfg.soneb.submetered ? "1" : "",
    sbeeSubmetered: cfg.sbee.submetered ? "1" : "",
    sonebUnitPrice: cfg.soneb.unitPrice != null ? String(cfg.soneb.unitPrice) : "",
    sbeeUnitPrice: cfg.sbee.unitPrice != null ? String(cfg.sbee.unitPrice) : "",
    sonebMainMeterNumber: cfg.soneb.mainMeterNumber ?? "",
    sbeeMainMeterNumber: cfg.sbee.mainMeterNumber ?? "",
    sonebAccountNumber: cfg.soneb.accountNumber ?? "",
    sbeeAccountNumber: cfg.sbee.accountNumber ?? "",
    sonebLossAllocation: cfg.soneb.lossAllocation,
    sbeeLossAllocation: cfg.sbee.lossAllocation,
  }));
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    const payload: UtilityConfigInput = {
      sonebSubmetered: form.sonebSubmetered === "1",
      sbeeSubmetered: form.sbeeSubmetered === "1",
      sonebUnitPrice: form.sonebUnitPrice ? Number(form.sonebUnitPrice) : null,
      sbeeUnitPrice: form.sbeeUnitPrice ? Number(form.sbeeUnitPrice) : null,
      sonebMainMeterNumber: form.sonebMainMeterNumber,
      sbeeMainMeterNumber: form.sbeeMainMeterNumber,
      sonebAccountNumber: form.sonebAccountNumber,
      sbeeAccountNumber: form.sbeeAccountNumber,
      sonebLossAllocation: form.sonebLossAllocation as "proprietaire" | "prorata",
      sbeeLossAllocation: form.sbeeLossAllocation as "proprietaire" | "prorata",
    };
    try {
      await updatePropertyUtilityConfig(accessToken, property.id, payload);
      setEditing(false);
      onSaved();
      toast.success("Configuration des compteurs enregistrée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge size={16} className="text-ink-muted" />
            <CardTitle>Compteurs & fluides</CardTitle>
          </div>
          {!editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Configurer
            </Button>
          )}
        </div>
        <CardDescription>
          Sous-comptage SONEB / SBEE : un décompteur par unité, un compteur principal pour l&apos;immeuble.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {!editing ? (
          <>
            {!anySubmetered ? (
              <p className="text-body-sm text-ink-muted">
                Aucun sous-comptage activé. Activez SONEB et/ou SBEE pour utiliser le relevé mensuel par immeuble.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(["soneb", "sbee"] as const).map((u) => (
                  <div key={u} className="rounded-lg border border-border p-3">
                    <p className="font-label-md text-ink">{UTILITY_TYPE_LABELS[u]}</p>
                    {cfg[u].submetered ? (
                      <ul className="mt-1 space-y-0.5 text-body-sm text-ink-soft">
                        <li>Tarif : {cfg[u].unitPrice != null ? `${formatFcfa(cfg[u].unitPrice ?? 0)} / unité` : "à définir"}</li>
                        {cfg[u].mainMeterNumber && <li>Compteur principal : {cfg[u].mainMeterNumber}</li>}
                        {cfg[u].accountNumber && <li>Abonnement : {cfg[u].accountNumber}</li>}
                        <li>Écart compteur/décompteurs : {LOSS_ALLOCATION_LABELS[cfg[u].lossAllocation]}</li>
                      </ul>
                    ) : (
                      <p className="mt-1 text-body-sm text-ink-muted">Non sous-compté</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {anySubmetered && (
              <Link
                href="/espace/charges/releves"
                className="inline-flex w-fit items-center gap-1 text-body-sm text-primary hover:underline"
              >
                Ouvrir les relevés de cet immeuble
              </Link>
            )}
          </>
        ) : (
          <>
            {(["soneb", "sbee"] as const).map((u) => {
              const cap = u === "soneb" ? "soneb" : "sbee";
              return (
                <div key={u} className="rounded-lg border border-border p-3">
                  <label className="flex items-center gap-2 font-label-md text-ink">
                    <input
                      type="checkbox"
                      checked={form[`${cap}Submetered`] === "1"}
                      onChange={(e) => set(`${cap}Submetered`, e.target.checked ? "1" : "")}
                    />
                    {UTILITY_TYPE_LABELS[u]} sous-compté
                  </label>
                  {form[`${cap}Submetered`] === "1" && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Field label="Tarif / unité (FCFA)" htmlFor={`${cap}Price`} required>
                        <Input
                          id={`${cap}Price`}
                          inputMode="numeric"
                          value={form[`${cap}UnitPrice`]}
                          onChange={(e) => set(`${cap}UnitPrice`, e.target.value.replace(/[^0-9.]/g, ""))}
                        />
                      </Field>
                      <Field label="N° compteur principal" htmlFor={`${cap}Meter`}>
                        <Input
                          id={`${cap}Meter`}
                          value={form[`${cap}MainMeterNumber`]}
                          onChange={(e) => set(`${cap}MainMeterNumber`, e.target.value)}
                        />
                      </Field>
                      <Field label="N° abonnement" htmlFor={`${cap}Account`}>
                        <Input
                          id={`${cap}Account`}
                          value={form[`${cap}AccountNumber`]}
                          onChange={(e) => set(`${cap}AccountNumber`, e.target.value)}
                        />
                      </Field>
                    </div>
                  )}
                  {form[`${cap}Submetered`] === "1" && (
                    <div className="mt-3">
                      <Field
                        label="Écart compteur principal / décompteurs"
                        htmlFor={`${cap}LossAllocation`}
                        hint="Par défaut, à la charge du propriétaire — jamais refacturé sans ce réglage."
                      >
                        <select
                          id={`${cap}LossAllocation`}
                          value={form[`${cap}LossAllocation`]}
                          onChange={(e) => set(`${cap}LossAllocation`, e.target.value)}
                          className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink"
                        >
                          <option value="proprietaire">{LOSS_ALLOCATION_LABELS.proprietaire}</option>
                          <option value="prorata">{LOSS_ALLOCATION_LABELS.prorata}</option>
                        </select>
                      </Field>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-body-xs text-ink-muted">
              Le numéro de décompteur de chaque unité se renseigne sur l&apos;unité elle-même (SONEB / SBEE).
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Annuler
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Attribution à un agent (étape 14) — directement depuis la fiche du Bien,
 * en complément de la carte équivalente sur la fiche de l'employé (seul
 * endroit qui existait jusqu'ici). Un DG cherchant « à qui confier CE bien »
 * regarde naturellement la fiche du Bien, pas celle d'un employé au hasard —
 * absence remontée comme « l'attribution ne marche pas » alors que le
 * mécanisme lui-même (back-end, restriction de portée) fonctionnait déjà.
 * Réservée au DG (même règle que le routeur `employees.js`, DG uniquement).
 */
function AgentAssignmentCard({
  property,
  accessToken,
  onSaved,
}: {
  property: Property;
  accessToken: string | null;
  onSaved: () => void;
}) {
  const [agents, setAgents] = React.useState<Employee[] | null>(null);
  const [selected, setSelected] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (!accessToken) return;
    listEmployees(accessToken)
      .then((res) => setAgents(res.employees.filter((e) => e.role === "agent" && e.status === "active")))
      .catch(() => setAgents([]));
  }, [accessToken]);

  async function handleAssign() {
    if (!accessToken || !selected) return;
    setSaving(true);
    setError(null);
    try {
      await assignProperties(accessToken, Number(selected), [property.id]);
      setSelected("");
      onSaved();
      toast.success("Bien attribué à l'agent.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Attribution impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnassign() {
    if (!accessToken || !property.agent) return;
    setSaving(true);
    setError(null);
    try {
      await unassignProperty(accessToken, property.agent.id, property.id);
      onSaved();
      toast.info("Attribution retirée — ce Bien redevient accessible à tout agent sans portefeuille.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de retirer l'attribution.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserCog size={16} className="text-ink-muted" />
          <CardTitle>Agent responsable</CardTitle>
        </div>
        <CardDescription>
          Un agent sans aucun Bien attribué garde de toute façon un accès complet au
          portefeuille — l&apos;attribution ne restreint un agent qu&apos;à partir de son
          premier Bien reçu.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {property.agent ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
            <span className="text-body-sm text-ink">
              Géré par <span className="font-label-md">{property.agent.name}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={handleUnassign} disabled={saving}>
              <UserX size={14} />
              Retirer
            </Button>
          </div>
        ) : agents === null ? (
          <p className="text-body-sm text-ink-muted">Chargement des agents…</p>
        ) : agents.length === 0 ? (
          <p className="text-body-sm text-ink-muted">
            Aucun agent actif dans l&apos;entreprise. Créez-en un depuis « Employés ».
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="h-[38px] flex-1 rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">Choisir un agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>
              ))}
            </select>
            <Button size="sm" onClick={handleAssign} disabled={saving || !selected}>
              {saving ? "…" : "Attribuer"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Action « le locataire a quitté » : termine le bail actif et remet l'unité « Libre ». */
function ReleaseUnitAction({
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
function PublishListingForm({
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

function NewUnitForm({
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
