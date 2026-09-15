/** Miroir de backend/src/constants/inspection.js — refonte par zones (étape 13, idée n°9). */

export type InspectionZoneTemplate = { key: string; label: string; items: { key: string; label: string }[] };

export const INSPECTION_ZONES: InspectionZoneTemplate[] = [
  {
    key: "devanture",
    label: "Devanture",
    items: [
      { key: "porte_entree", label: "Porte d'entrée" },
      { key: "auvent", label: "Auvent" },
      { key: "terrasse", label: "Terrasse" },
      { key: "portail", label: "Portail" },
      { key: "cloture", label: "Clôture" },
      { key: "eclairage_exterieur", label: "Éclairage extérieur" },
      { key: "boite_lettres", label: "Boîte aux lettres" },
      { key: "sonnette_interphone", label: "Sonnette/interphone" },
    ],
  },
  {
    key: "chambre",
    label: "Chambre",
    items: [
      { key: "lampe", label: "Lampe" },
      { key: "brasseur_ventilateur", label: "Brasseur/ventilateur" },
      { key: "climatiseur", label: "Climatiseur" },
      { key: "prise_electrique", label: "Prise électrique" },
      { key: "interrupteur", label: "Interrupteur" },
      { key: "poste_televiseur", label: "Poste téléviseur" },
      { key: "sol_carrelage", label: "Sol/carrelage" },
      { key: "plafond", label: "Plafond" },
      { key: "murs_peinture", label: "Murs/peinture" },
      { key: "fenetre", label: "Fenêtre" },
      { key: "moustiquaire", label: "Moustiquaire" },
      { key: "porte", label: "Porte" },
    ],
  },
  {
    key: "salon",
    label: "Salon",
    items: [
      { key: "lampe", label: "Lampe" },
      { key: "brasseur_ventilateur", label: "Brasseur/ventilateur" },
      { key: "prises_electriques", label: "Prises électriques" },
      { key: "sol_carrelage", label: "Sol/carrelage" },
      { key: "plafond", label: "Plafond" },
      { key: "murs_peinture", label: "Murs/peinture" },
      { key: "fenetre", label: "Fenêtre" },
    ],
  },
  {
    key: "cuisine",
    label: "Cuisine",
    items: [
      { key: "evier", label: "Évier" },
      { key: "robinetterie", label: "Robinetterie" },
      { key: "sol_carrelage", label: "Sol/carrelage" },
      { key: "plafond", label: "Plafond" },
      { key: "prises_electriques", label: "Prises électriques" },
      { key: "placards", label: "Placards" },
      { key: "carrelage_mural", label: "Carrelage mural" },
      { key: "hotte", label: "Hotte" },
    ],
  },
  {
    key: "douche_sdb",
    label: "Douche/Salle de bain",
    items: [
      { key: "lavabo", label: "Lavabo" },
      { key: "colonne_douche", label: "Colonne de douche" },
      { key: "wc_toilette", label: "WC/toilette" },
      { key: "robinetterie", label: "Robinetterie" },
      { key: "sol_carrelage", label: "Sol/carrelage" },
      { key: "carrelage_mural", label: "Carrelage mural" },
      { key: "miroir", label: "Miroir" },
      { key: "porte_serviette", label: "Porte-serviette" },
    ],
  },
];

export const INSPECTION_CONDITIONS = ["BE", "ME", "SR"] as const;
export type InspectionCondition = (typeof INSPECTION_CONDITIONS)[number];

export const CONDITION_LABELS: Record<InspectionCondition, string> = {
  BE: "Bon état",
  ME: "Mauvais état",
  SR: "Sous réserve",
};

/** Échelle ORDONNÉE (décision produit) : BE > SR > ME — rang plus élevé = meilleur état. */
export const CONDITION_RANK: Record<InspectionCondition, number> = { BE: 2, SR: 1, ME: 0 };

export function conditionBadgeVariant(c: InspectionCondition | null): "success" | "warning" | "danger" | "neutral" {
  if (c === "BE") return "success";
  if (c === "SR") return "warning";
  if (c === "ME") return "danger";
  return "neutral";
}

/** Génère un identifiant unique (assez) pour une zone/un élément ajouté à la volée par l'utilisateur. */
export function generateCustomKey(prefix: string): string {
  return `custom_${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
