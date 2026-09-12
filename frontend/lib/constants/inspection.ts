/** Miroir de backend/src/constants/inspection.js pour construire le formulaire. */
export const INSPECTION_ITEMS = [
  "Murs et peinture",
  "Sol / carrelage",
  "Plafond",
  "Plomberie",
  "Installation électrique",
  "Portes et fenêtres",
  "Cuisine",
  "Sanitaires",
  "Serrures et clés",
] as const;

export const INSPECTION_CONDITIONS = ["bon", "moyen", "mauvais"] as const;
export type InspectionCondition = (typeof INSPECTION_CONDITIONS)[number];

export const CONDITION_LABELS: Record<InspectionCondition, string> = {
  bon: "Bon",
  moyen: "Moyen",
  mauvais: "Mauvais",
};
