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

  return (
    <div className="flex flex-col gap-2">
      <div ref={containerRef} className="overflow-hidden rounded-lg border border-border-strong" style={{ height }} />
      <p className="text-body-xs text-ink-muted">Cliquez sur la carte à l&apos;emplacement du bien pour placer le repère.</p>
    </div>
  );
}
