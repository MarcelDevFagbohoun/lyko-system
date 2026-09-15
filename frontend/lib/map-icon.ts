import L from "leaflet";

/** Repère en forme de goutte, en CSS pur : évite de dépendre des images
 * marker-icon.png / marker-shadow.png par défaut de Leaflet, dont l'URL ne
 * se résout pas correctement une fois passées par le bundler de Next.js. */
export function createPinIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;background:${color};border:2px solid white;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -26],
  });
}

/** Centre par défaut : Cotonou (Bénin). */
export const DEFAULT_MAP_CENTER: [number, number] = [6.3703, 2.3912];
