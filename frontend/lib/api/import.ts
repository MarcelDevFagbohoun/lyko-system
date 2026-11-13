import { API_URL, ApiError, downloadAuthenticatedFile } from "./client";

/**
 * Import en masse depuis Excel (propriétaires, logements, locataires) — voir backend
 * `services/bulkImport.js`. L'aperçu ne crée rien ; la confirmation importe tout ou rien.
 */
export type ImportError = { sheet: string | null; row: number | null; column: string | null; message: string };
export type ImportSummary = {
  ownersCreated: number;
  ownersReused: number;
  properties: number;
  units: number;
  vacantUnits: number;
  renters: number;
};
export type ImportResult = { ok: boolean; summary: ImportSummary; errors: ImportError[]; errorCount: number };

export const downloadImportTemplate = (accessToken: string) =>
  downloadAuthenticatedFile("/api/import/template", accessToken, "modele-import-africa-immo.xlsx");

/**
 * Envoie le fichier pour aperçu ou import définitif. Un fichier à corriger n'est PAS une exception :
 * la réponse (200 pour l'aperçu, 422 pour une confirmation refusée) porte la liste des erreurs, et
 * c'est elle que l'écran affiche. Seule une vraie panne (réseau, droits, fichier illisible) lève.
 */
export async function sendImport(accessToken: string, file: File, mode: "preview" | "confirm"): Promise<ImportResult> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`${API_URL}/api/import/${mode}`, {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if ((res.ok || res.status === 422) && body && typeof body.ok === "boolean") return body as ImportResult;
  throw new ApiError(res.status, body?.error || `Erreur ${res.status}`);
}
