"use client";

import * as React from "react";
import { Copy, MapPin, MessageCircle, Navigation, Share2 } from "lucide-react";
import { directionsUrl, shareText, whatsappShareUrl } from "@/lib/maps";
import { ApiError } from "@/lib/api/client";
import { updateProperty, type Property } from "@/lib/api/properties";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";
import { LocationPicker } from "./shared";

/**
 * Repère GPS du Bien (étape 13, idée n°10 : carte du portefeuille) — placé à
 * la main sur une carte (jamais géocodé depuis l'adresse texte libre, trop
 * imprécise au Bénin). Permet de retrouver ce Bien sur « Nos biens » → Carte.
 */
export function LocationCard({
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

  const located = property.latitude != null && property.longitude != null;
  const here = located ? { lat: property.latitude as number, lng: property.longitude as number } : null;
  const text = here ? shareText({ code: property.code, address: property.address }, here) : "";

  // Menu natif de partage du téléphone (WhatsApp, SMS, Messenger…) quand il existe ; sinon WhatsApp et copie ci-dessous.
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  async function nativeShare() {
    if (!here) return;
    try {
      await navigator.share({ title: `Bien ${property.code}`, text });
    } catch {
      /* partage annulé par l'utilisateur */
    }
  }
  async function copyLink() {
    if (!here) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Lien copié.");
    } catch {
      toast.error("Copie impossible. Utilisez WhatsApp ou partagez depuis le navigateur.");
    }
  }

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
        <CardDescription>Repère utilisé par la carte du portefeuille. Le lien d&apos;itinéraire s&apos;ouvre dans Google Maps depuis la position de la personne qui le reçoit.</CardDescription>
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
              {here && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={directionsUrl(here)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-body-sm font-label-md text-primary-fg hover:opacity-90"
                  >
                    <Navigation size={14} /> Itinéraire
                  </a>
                  {canNativeShare ? (
                    <Button size="sm" variant="secondary" onClick={nativeShare}>
                      <Share2 size={14} /> Partager la position
                    </Button>
                  ) : (
                    <a
                      href={whatsappShareUrl(text)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-body-sm text-ink hover:bg-surface-muted"
                    >
                      <MessageCircle size={14} /> Envoyer par WhatsApp
                    </a>
                  )}
                  <Button size="sm" variant="ghost" onClick={copyLink}>
                    <Copy size={14} /> Copier le lien
                  </Button>
                </div>
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
