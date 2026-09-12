import type { ComplaintCategory, ComplaintPriority, ComplaintStatus } from "@/lib/api/complaints";

/** Miroir de backend/src/constants/complaints.js pour l'affichage côté client. */
export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  plomberie: "Plomberie",
  electricite: "Électricité",
  serrurerie: "Serrurerie",
  climatisation: "Climatisation",
  maconnerie: "Maçonnerie / structure",
  autre: "Autre",
};

export const COMPLAINT_PRIORITY_LABELS: Record<ComplaintPriority, string> = {
  normale: "Normale",
  urgente: "Urgente",
};

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  ouverte: "Ouverte",
  en_cours: "En cours",
  resolue: "Résolue",
  fermee: "Fermée",
};
