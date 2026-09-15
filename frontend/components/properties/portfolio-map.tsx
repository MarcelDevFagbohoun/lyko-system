"use client";

import * as React from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { createPinIcon } from "@/lib/map-icon";
import type { PropertyListItem } from "@/lib/api/properties";

const pinIcon = createPinIcon("#2563eb");

type LocatedProperty = PropertyListItem & { latitude: number; longitude: number };

/**
 * Carte du portefeuille (étape 13, idée n°10) : un repère par Bien localisé.
 * Les Biens sans coordonnées (repère jamais placé) sont listés à part par
 * l'appelant — jamais silencieusement absents de la vue.
 *
 * Implémenté avec l'API impérative de Leaflet (voir le commentaire dans
 * `location-picker.tsx` pour la raison : `<MapContainer>` de react-leaflet
 * casse sous React 18 StrictMode en dev).
 */
export default function PortfolioMap({ properties }: { properties: PropertyListItem[] }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const layerGroupRef = React.useRef<L.LayerGroup | null>(null);

  const located = React.useMemo(
    () => properties.filter((p): p is LocatedProperty => p.latitude != null && p.longitude != null),
    [properties],
  );
  const hasAny = located.length > 0;

  React.useEffect(() => {
    if (!containerRef.current || !hasAny) return;
    const center: [number, number] = [located[0].latitude, located[0].longitude];
    const map = L.map(containerRef.current, { center, zoom: 12 });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerGroupRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
    // Ne recrée la carte que quand on bascule "aucun repère" <-> "au moins un repère" ;
    // les mises à jour de la liste rafraîchissent seulement les marqueurs (effet suivant).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAny]);

  React.useEffect(() => {
    const group = layerGroupRef.current;
    if (!group) return;
    group.clearLayers();
    located.forEach((p) => {
      const popup = document.createElement("div");
      popup.className = "flex flex-col gap-0.5 text-sm";

      const codeEl = document.createElement("span");
      codeEl.className = "font-semibold";
      codeEl.textContent = p.code;
      popup.appendChild(codeEl);

      const ownerEl = document.createElement("span");
      ownerEl.textContent = p.owner.name;
      popup.appendChild(ownerEl);

      if (p.address) {
        const addrEl = document.createElement("span");
        addrEl.className = "text-ink-muted";
        addrEl.textContent = p.address;
        popup.appendChild(addrEl);
      }

      const link = document.createElement("a");
      link.href = `/espace/biens/${p.id}`;
      link.textContent = "Voir le détail";
      link.className = "mt-1 text-primary hover:underline";
      popup.appendChild(link);

      L.marker([p.latitude, p.longitude], { icon: pinIcon }).bindPopup(popup).addTo(group);
    });
  }, [located]);

  if (!hasAny) {
    return (
      <p className="text-body-sm text-ink-muted">
        Aucun bien ne possède encore de coordonnées GPS. Ouvrez la fiche d&apos;un bien pour placer son repère.
      </p>
    );
  }

  return <div ref={containerRef} className="overflow-hidden rounded-lg border border-border-strong" style={{ height: 480 }} />;
}
