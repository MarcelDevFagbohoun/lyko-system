"use client";



import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Phone,
  MapPin,
  Layers,
  Check,
  Store,
  Pencil,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import { getProperty, type Property, type Unit } from "@/lib/api/properties";
import { PROPERTY_TYPE_LABELS, unitDesignationLabel } from "@/lib/constants/properties";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NoteThread } from "@/components/notes/note-thread";
import { Attribution } from "@/components/ui/attribution";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
} from "@/components/ui/table";
import { useCan } from "@/lib/auth/use-can";
import { AgentAssignmentCard } from "./sections/agent-assignment-card";
import { LocationCard } from "./sections/location-card";
import { RecetteCard } from "./sections/recette-card";
import { UNIT_STATUS_BADGE } from "./sections/shared";
import { EditUnitForm, NewUnitForm, PublishListingForm, ReleaseUnitAction } from "./sections/unit-forms";
import { UtilityConfigCard } from "./sections/utility-config-card";
import { PropertyChargesCard } from "./sections/property-charges-card";

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
  const { accessToken, user, tenant } = useAuth();
  // Module Charges (SONEB/SBEE) : masqué si désactivé pour l'entreprise ou si l'employé n'a pas
  // la permission dédiée (même règle que côté serveur, `requirePermission('charges')`).
  const canSeeCharges = !!tenant?.chargesEnabled && (user?.role === "dg" || !!user?.permissions.includes("charges"));
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
  const canManageExpenses = useCan("comptabilite");

  const [property, setProperty] = React.useState<Property | null>(null);
  const [units, setUnits] = React.useState<Unit[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [showUnitForm, setShowUnitForm] = React.useState(false);
  const [justFreed, setJustFreed] = React.useState<string | null>(null);
  const [publishingUnit, setPublishingUnit] = React.useState<Unit | null>(null);
  const [editingUnit, setEditingUnit] = React.useState<Unit | null>(null);

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
          <CardContent className="pt-5">
            <NoteThread entityType="property" entityId={property.id} accessToken={accessToken} title="Notes sur ce bien" />
          </CardContent>
        </Card>

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

            {property.photoUrls.length > 0 && accessToken && (
              <div className="flex flex-wrap gap-3">
                {property.photoUrls.map((url) => (
                  <AuthenticatedImage
                    key={url}
                    src={url}
                    accessToken={accessToken}
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

        {canSeeCharges && <PropertyChargesCard propertyId={propertyId} accessToken={accessToken} />}

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
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditingUnit(u)} aria-label="Modifier">
                          <Pencil size={14} />
                        </Button>
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
                      </div>
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

        {editingUnit && (
          <EditUnitForm
            propertyId={propertyId}
            unit={editingUnit}
            accessToken={accessToken}
            onCancel={() => setEditingUnit(null)}
            onSaved={() => {
              setEditingUnit(null);
              load();
            }}
          />
        )}
      </div>
    </div>
  );
}

