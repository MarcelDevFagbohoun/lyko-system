import type { ComplaintPriority, ComplaintStatus } from "@/lib/api/complaints";

/** Miroir de backend/src/constants/complaints.js pour l'affichage côté client. */

export const COMPLAINT_PRIORITY_LABELS: Record<ComplaintPriority, string> = {
  normale: "Normale",
  urgente: "Urgente",
};

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  non_resolue: "Non résolue",
  resolue: "Résolue",
};

/** Deux statuts seulement : vert = résolue, rouge = non résolue. Utilisé par toutes les pages plaintes (registre, dossier, portails). */
export const COMPLAINT_STATUS_BADGE_VARIANT: Record<ComplaintStatus, "success" | "danger"> = {
  non_resolue: "danger",
  resolue: "success",
};
