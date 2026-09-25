import type { CardTone } from "@/components/ui/card";

/**
 * Le « cadre » d'une page : la rubrique du menu à laquelle elle appartient. Une couleur = un cadre,
 * et un cadre = une seule couleur, partout où elle apparaît (titre de rubrique et icônes du menu,
 * filet en haut de page, fond des cartes et en-têtes de tableaux). Ainsi la couleur dit d'où l'on
 * vient et où l'on est, sans avoir à lire le titre.
 *
 * Ces couleurs sont volontairement distinctes des couleurs de STATUT (vert = payé/à jour, ambre =
 * attention, rouge = retard) — qui gardent leur sens partout, y compris dans un cadre teinté.
 *
 * Les classes sont écrites en toutes lettres (jamais composées) : c'est ce qui permet à Tailwind de
 * les détecter.
 */
export type Cadre = "apercu" | "patrimoine" | "operations" | "finances" | "administration";

export interface CadreTheme {
  /** Titre de la rubrique dans le menu. */
  label: string;
  /** Ce que la couleur exprime — sert de légende. */
  meaning: string;
  /** Teinte des cartes et des tableaux du cadre. */
  tone: CardTone;
  /** Aplat plein (pastille de rubrique, filet en haut de page). */
  solid: string;
  /** Texte / icône de la couleur du cadre. */
  text: string;
  /** Fond doux (entrée de menu active). */
  soft: string;
}

export const CADRES: Record<Cadre, CadreTheme> = {
  apercu: {
    label: "Vue d'ensemble",
    meaning: "Bleu — l'identité Lyko : le regard d'ensemble sur le cabinet.",
    tone: "blue",
    solid: "bg-tint-blue-solid",
    text: "text-tint-blue-solid",
    soft: "bg-tint-blue-bg",
  },
  patrimoine: {
    label: "Patrimoine",
    meaning: "Violet — ce que l'on gère : les biens, ceux qui les possèdent et ceux qui les occupent.",
    tone: "violet",
    solid: "bg-tint-violet-solid",
    text: "text-tint-violet-solid",
    soft: "bg-tint-violet-bg",
  },
  operations: {
    label: "Opérations",
    meaning: "Orange — l'action au quotidien : ce qui demande d'agir (plaintes, relances, tâches).",
    tone: "orange",
    solid: "bg-tint-orange-solid",
    text: "text-tint-orange-solid",
    soft: "bg-tint-orange-bg",
  },
  finances: {
    label: "Finances",
    meaning: "Cyan — l'argent qui circule : comptabilité, loyers encaissés, eau et électricité.",
    tone: "cyan",
    solid: "bg-tint-cyan-solid",
    text: "text-tint-cyan-solid",
    soft: "bg-tint-cyan-bg",
  },
  administration: {
    label: "Administration",
    meaning: "Ardoise — le fonctionnement du cabinet : équipe, réglages, journal, compte personnel.",
    tone: "slate",
    solid: "bg-tint-slate-solid",
    text: "text-tint-slate-solid",
    soft: "bg-tint-slate-bg",
  },
};

/** Rubrique de menu de chaque page de l'espace. Toute page non listée relève de l'administration. */
const CADRE_PREFIXES: [prefix: string, cadre: Cadre][] = [
  ["/espace/tableau-de-bord", "apercu"],
  ["/espace/biens", "patrimoine"],
  ["/espace/proprietaires", "patrimoine"],
  ["/espace/locataires", "patrimoine"],
  ["/espace/marketplace", "patrimoine"],
  ["/espace/plaintes", "operations"],
  ["/espace/relances", "operations"],
  ["/espace/taches", "operations"],
  ["/espace/comptabilite", "finances"], // couvre aussi /espace/comptabilite-avancee
  ["/espace/charges", "finances"],
];

export function cadreForPath(pathname: string): Cadre {
  if (pathname === "/espace") return "apercu";
  const hit = CADRE_PREFIXES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix));
  return hit?.[1] ?? "administration";
}
