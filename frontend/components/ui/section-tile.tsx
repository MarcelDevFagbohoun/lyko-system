import * as React from "react";
import { cn } from "@/lib/utils";
import type { CardTone } from "@/components/ui/card";

/**
 * Bloc de section à l'intérieur d'une fiche (reçu d'entrée, cautions, registre des paiements…) : fond très clair
 * de la couleur de sa famille + filet plein à gauche. Une couleur = un type de contenu, partout (voir la
 * répartition dans `lib/section-tones.ts`). Les couleurs de statut (vert/rouge/orange des pastilles) restent
 * réservées aux statuts.
 */
const TILE: Partial<Record<CardTone, string>> = {
  blue: "border-tint-blue-border border-l-tint-blue-solid bg-tint-blue-bg",
  violet: "border-tint-violet-border border-l-tint-violet-solid bg-tint-violet-bg",
  orange: "border-tint-orange-border border-l-tint-orange-solid bg-tint-orange-bg",
  cyan: "border-tint-cyan-border border-l-tint-cyan-solid bg-tint-cyan-bg",
  teal: "border-tint-teal-border border-l-tint-teal-solid bg-tint-teal-bg",
  amber: "border-tint-amber-border border-l-tint-amber-solid bg-tint-amber-bg",
  rose: "border-tint-rose-border border-l-tint-rose-solid bg-tint-rose-bg",
  slate: "border-tint-slate-border border-l-tint-slate-solid bg-tint-slate-bg",
};

export function SectionTile({ tone, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { tone: CardTone }) {
  return <div className={cn("flex flex-col gap-3 rounded-lg border border-l-4 p-4", TILE[tone], className)} {...props} />;
}
