import * as React from "react";
import { cn } from "@/lib/utils";
import type { CardTone } from "@/components/ui/card";

/**
 * Bloc de section à l'intérieur d'une fiche (reçu d'entrée, cautions, registre des paiements…) : fond teinté
 * de la couleur de sa famille, SANS filet (demande utilisateur, 2026-10-30 : « j'aime pas les bordures »)
 * — la couleur de fond suffit à distinguer le type de contenu (voir la répartition dans `lib/section-tones.ts`).
 * À la place du filet : une ombre douce teintée de la même couleur (via la variable `--tw-shadow-color`, posée
 * par l'utilitaire `shadow-tint-…`) qui s'accentue et soulève légèrement la tuile au survol, plus une apparition
 * en fondu à l'affichage (`animate-card-in`, déjà utilisé par `Card` — coupée si l'utilisateur a demandé moins
 * d'animations). Les couleurs de statut (vert/rouge/orange des pastilles) restent réservées aux statuts.
 */
const TILE: Partial<Record<CardTone, string>> = {
  blue: "bg-tint-blue-bg shadow-tint-blue-solid/20 hover:shadow-tint-blue-solid/35",
  violet: "bg-tint-violet-bg shadow-tint-violet-solid/20 hover:shadow-tint-violet-solid/35",
  orange: "bg-tint-orange-bg shadow-tint-orange-solid/20 hover:shadow-tint-orange-solid/35",
  cyan: "bg-tint-cyan-bg shadow-tint-cyan-solid/20 hover:shadow-tint-cyan-solid/35",
  teal: "bg-tint-teal-bg shadow-tint-teal-solid/20 hover:shadow-tint-teal-solid/35",
  amber: "bg-tint-amber-bg shadow-tint-amber-solid/20 hover:shadow-tint-amber-solid/35",
  rose: "bg-tint-rose-bg shadow-tint-rose-solid/20 hover:shadow-tint-rose-solid/35",
  slate: "bg-tint-slate-bg shadow-tint-slate-solid/20 hover:shadow-tint-slate-solid/35",
};

export function SectionTile({ tone, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { tone: CardTone }) {
  return (
    <div
      className={cn(
        "animate-card-in flex flex-col gap-3 rounded-xl p-4",
        "shadow-[0_6px_18px_-8px_var(--tw-shadow-color)] transition-[transform,box-shadow] duration-300 ease-out",
        "hover:-translate-y-1 hover:shadow-[0_16px_32px_-10px_var(--tw-shadow-color)]",
        TILE[tone],
        className,
      )}
      {...props}
    />
  );
}
