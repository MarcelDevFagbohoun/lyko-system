"use client";

import * as React from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { createPinIcon, DEFAULT_MAP_CENTER } from "@/lib/map-icon";

const pinIcon = createPinIcon("#dc2626");

type LocationPickerProps = {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
  height?: number;
};

/**
 * Placement manuel d'un repère GPS sur une carte OpenStreetMap (clic pour
 * placer/déplacer) — pas de géocodage automatique de l'adresse : au Bénin,
 * une adresse est souvent un simple nom de quartier, trop imprécise.
 *
 * Implémenté avec l'API impérative de Leaflet plutôt qu'avec `<MapContainer>`
 * de react-leaflet : sous React 18 + StrictMode (double-montage des effets en
 * dev), `<MapContainer>` referme sur un `context` obsolète et retente
 * `new L.Map()` sur un conteneur déjà initialisé → « Map container is already
 * initialized. ». Ici l'effet crée/détruit la carte lui-même, donc le
 * double-montage recrée proprement (cleanup → `map.remove()` → remount).
 */
export default function LocationPicker({ latitude, longitude, onChange, height = 320 }: LocationPickerProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const markerRef = React.useRef<L.Marker | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useEffect(() => {
    if (!containerRef.current) return;
    const hasPosition = latitude != null && longitude != null;
    const initialCenter: [number, number] = hasPosition ? [latitude, longitude] : DEFAULT_MAP_CENTER;

    const map = L.map(containerRef.current, { center: initialCenter, zoom: hasPosition ? 15 : 12 });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    if (hasPosition) {
      markerRef.current = L.marker(initialCenter, { icon: pinIcon }).addTo(map);
    }

    map.on("click", (e: L.LeafletMouseEvent) => {
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Montée une seule fois : les mises à jour de position ne recréent pas la carte, voir ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (latitude == null || longitude == null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const pos: [number, number] = [latitude, longitude];
    if (markerRef.current) {
      markerRef.current.setLatLng(pos);
    } else {
      markerRef.current = L.marker(pos, { icon: pinIcon }).addTo(map);
    }
  }, [latitude, longitude]);

  // Saisie manuelle (copier-coller depuis Google Maps par exemple) — en plus
  // du clic sur la carte, jamais à sa place : un DG qui connaît déjà les
  // coordonnées exactes n'a pas à viser un point précis sur une petite carte
  // centrée sur Cotonou, souvent imprécis au premier essai.
  const [latText, setLatText] = React.useState(latitude != null ? String(latitude) : "");
  const [lngText, setLngText] = React.useState(longitude != null ? String(longitude) : "");

  React.useEffect(() => {
    setLatText(latitude != null ? String(latitude) : "");
    setLngText(longitude != null ? String(longitude) : "");
  }, [latitude, longitude]);

  function commitManualCoords(nextLatText: string, nextLngText: string) {
    const lat = Number(nextLatText);
    const lng = Number(nextLngText);
    if (nextLatText.trim() === "" || nextLngText.trim() === "") return;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return;
    onChangeRef.current(lat, lng);
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={containerRef} className="overflow-hidden rounded-lg border border-border-strong" style={{ height }} />
      <p className="text-body-xs text-ink-muted">Cliquez sur la carte à l&apos;emplacement du bien pour placer le repère.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-body-xs text-ink-muted">Latitude</span>
          <input
            type="text"
            inputMode="decimal"
            value={latText}
            placeholder="ex. 6.36682"
            onChange={(e) => setLatText(e.target.value)}
            onBlur={() => commitManualCoords(latText, lngText)}
            className="h-9 rounded border border-border-strong bg-surface px-2 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-xs text-ink-muted">Longitude</span>
          <input
            type="text"
            inputMode="decimal"
            value={lngText}
            placeholder="ex. 2.39468"
            onChange={(e) => setLngText(e.target.value)}
            onBlur={() => commitManualCoords(latText, lngText)}
            className="h-9 rounded border border-border-strong bg-surface px-2 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
      </div>
      <p className="text-body-xs text-ink-muted">
        Ou collez directement les coordonnées (par exemple copiées depuis Google Maps).
      </p>
    </div>
  );
}
