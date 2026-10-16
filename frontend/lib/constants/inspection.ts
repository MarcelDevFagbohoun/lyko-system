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

/**
 * Pièces types proposées à l'ajout (étape 56, demande de l'utilisateur : « ajouter par exemple un salon
 * et ses composants nous-mêmes »). Les cinq premières reprennent le modèle standard ci-dessus ; les
 * suivantes complètent les logements courants. Choisir une pièce type pré-remplit ses éléments
 * habituels — que l'agent peut ensuite retirer, renommer ou compléter librement. Les `key` d'éléments
 * restent stables d'une fiche à l'autre : la comparaison entrée/sortie s'appuie dessus.
 */
export const ROOM_PRESETS: InspectionZoneTemplate[] = [
  ...INSPECTION_ZONES,
  {
    key: "entree_couloir",
    label: "Entrée/Couloir",
    items: [
      { key: "porte", label: "Porte" },
      { key: "lampe", label: "Lampe" },
      { key: "interrupteur", label: "Interrupteur" },
      { key: "sol_carrelage", label: "Sol/carrelage" },
      { key: "murs_peinture", label: "Murs/peinture" },
      { key: "plafond", label: "Plafond" },
    ],
  },
  {
    key: "wc",
    label: "WC séparé",
    items: [
      { key: "wc_toilette", label: "WC/toilette" },
      { key: "chasse_eau", label: "Chasse d'eau" },
      { key: "lave_mains", label: "Lave-mains" },
      { key: "sol_carrelage", label: "Sol/carrelage" },
      { key: "porte", label: "Porte" },
    ],
  },
  {
    key: "balcon",
    label: "Balcon/Terrasse",
    items: [
      { key: "garde_corps", label: "Garde-corps" },
      { key: "sol_carrelage", label: "Sol/carrelage" },
      { key: "lampe", label: "Lampe" },
      { key: "porte_fenetre", label: "Porte-fenêtre" },
    ],
  },
  {
    key: "cour",
    label: "Cour",
    items: [
      { key: "portail", label: "Portail" },
      { key: "sol", label: "Sol" },
      { key: "eclairage_exterieur", label: "Éclairage extérieur" },
      { key: "robinet_exterieur", label: "Robinet extérieur" },
    ],
  },
  {
    key: "garage",
    label: "Garage",
    items: [
      { key: "porte_garage", label: "Porte de garage" },
      { key: "lampe", label: "Lampe" },
      { key: "sol", label: "Sol" },
      { key: "prise_electrique", label: "Prise électrique" },
    ],
  },
  {
    key: "bureau",
    label: "Bureau",
    items: [
      { key: "lampe", label: "Lampe" },
      { key: "prises_electriques", label: "Prises électriques" },
      { key: "climatiseur", label: "Climatiseur" },
      { key: "sol_carrelage", label: "Sol/carrelage" },
      { key: "murs_peinture", label: "Murs/peinture" },
      { key: "fenetre", label: "Fenêtre" },
      { key: "porte", label: "Porte" },
    ],
  },
];

/** Éléments courants proposés en un clic dans n'importe quelle pièce, en plus de ceux de sa pièce type. */
export const COMMON_ITEM_SUGGESTIONS: string[] = [
  "Lampe",
  "Interrupteur",
  "Prise électrique",
  "Brasseur/ventilateur",
  "Climatiseur",
  "Fenêtre",
  "Moustiquaire",
  "Porte",
  "Serrure",
  "Placard",
  "Rideaux/tringle",
  "Sol/carrelage",
  "Murs/peinture",
  "Plafond",
  "Robinetterie",
  "Prise TV/antenne",
];

/** Pièce type d'une zone, retrouvée par sa clé (« chambre », « chambre_2 »…) ; `null` pour une pièce libre. */
export function presetForZoneKey(zoneKey: string): InspectionZoneTemplate | null {
  const base = zoneKey.replace(/_\d+$/, "");
  return ROOM_PRESETS.find((p) => p.key === base) ?? null;
}

/**
 * Clé et libellé d'une nouvelle pièce type : « Chambre », puis « Chambre 2 », « Chambre 3 »… si la pièce
 * existe déjà — la clé suit (« chambre_2 ») pour rester stable et lisible dans la comparaison.
 */
export function nextRoomIdentity(preset: InspectionZoneTemplate, existingKeys: string[]): { key: string; label: string } {
  if (!existingKeys.includes(preset.key)) return { key: preset.key, label: preset.label };
  let n = 2;
  while (existingKeys.includes(`${preset.key}_${n}`)) n += 1;
  return { key: `${preset.key}_${n}`, label: `${preset.label} ${n}` };
}

/** Clé stable d'un élément saisi librement (« Prise TV/antenne » → « prise_tv_antenne »), unique dans sa pièce. */
export function itemKeyFromLabel(label: string, existingKeys: string[]): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "element";
  if (!existingKeys.includes(base)) return base;
  let n = 2;
  while (existingKeys.includes(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
