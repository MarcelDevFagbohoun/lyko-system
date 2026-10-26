/**
 * Liens de localisation d'un bien : itinéraire Google Maps et partage (WhatsApp, SMS, copie).
 * Le lien d'itinéraire s'ouvre dans l'appli Google Maps (ou le navigateur) et calcule le trajet depuis la position
 * actuelle de la personne qui l'ouvre : un nouvel agent n'a rien à installer ni aucun compte à créer.
 */

export type Coords = { lat: number; lng: number };

export function isValidCoords(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

const fmt = (n: number) => n.toFixed(6);

/** Itinéraire jusqu'au bien depuis la position actuelle de celui qui ouvre le lien. */
export function directionsUrl(c: Coords): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${fmt(c.lat)},${fmt(c.lng)}`;
}

/** Le bien sur la carte, sans calcul de trajet. */
export function viewUrl(c: Coords): string {
  return `https://www.google.com/maps/search/?api=1&query=${fmt(c.lat)},${fmt(c.lng)}`;
}

/** Texte envoyé avec le lien. Aucune donnée personnelle (ni propriétaire, ni locataire) : seulement le bien et son adresse. */
export function shareText(p: { code: string; address?: string | null }, c: Coords): string {
  const lines = [`📍 Bien ${p.code}`];
  if (p.address?.trim()) lines.push(p.address.trim());
  lines.push(`Itinéraire : ${directionsUrl(c)}`);
  return lines.join("\n");
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function smsShareUrl(text: string): string {
  return `sms:?&body=${encodeURIComponent(text)}`;
}

/**
 * Lit des coordonnées collées depuis Google Maps : « 6.366820, 2.394680 » (ou séparées par un espace / point-virgule).
 * Retourne null si le texte n'est pas une paire de coordonnées valide.
 */
export function parsePastedCoords(text: string): Coords | null {
  const m = text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return isValidCoords(lat, lng) ? { lat, lng } : null;
}

/** Message lisible pour une erreur de géolocalisation du navigateur (codes 1 à 3 de GeolocationPositionError). */
export function geolocationErrorMessage(code: number): string {
  if (code === 1) return "Localisation refusée. Autorisez-la pour ce site dans les réglages du navigateur, puis réessayez.";
  if (code === 2) return "Position introuvable. Activez le GPS du téléphone et réessayez à l'air libre.";
  if (code === 3) return "La recherche de position a pris trop de temps. Réessayez.";
  return "Impossible d'obtenir votre position.";
}
