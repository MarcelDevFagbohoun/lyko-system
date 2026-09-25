"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Teintes d'une carte « parent » : fond + liseré assortis. `default` = blanc (comportement d'origine).
 * Les teintes de cadre (`blue`, `violet`, `orange`, `cyan`, `slate` — voir `lib/module-theme.ts`) donnent son identité à un module ; les teintes de statut
 * (`success`, `warning`, `danger`, `info`) gardent leur sens (payé, attention, retard, information).
 * Un `className` explicite (bg-…, border-…) l'emporte toujours sur la teinte.
 */
export type CardTone = "default" | "blue" | "violet" | "orange" | "cyan" | "slate" | "teal" | "amber" | "rose" | "success" | "warning" | "danger" | "info";

const CARD_TONES: Record<CardTone, string> = {
  default: "border-border bg-surface",
  blue: "border-tint-blue-border bg-tint-blue-bg",
  violet: "border-tint-violet-border bg-tint-violet-bg",
  orange: "border-tint-orange-border bg-tint-orange-bg",
  cyan: "border-tint-cyan-border bg-tint-cyan-bg",
  teal: "border-tint-teal-border bg-tint-teal-bg",
  amber: "border-tint-amber-border bg-tint-amber-bg",
  rose: "border-tint-rose-border bg-tint-rose-bg",
  slate: "border-tint-slate-border bg-tint-slate-bg",
  success: "border-success-border bg-success-bg",
  warning: "border-warning-border bg-warning-bg",
  danger: "border-danger-border bg-danger-bg",
  info: "border-info-border bg-info-bg",
};

/**
 * Teinte « du module en cours » : l'espace connecté la fixe une fois pour toutes selon la page
 * (Biens = bleu, Propriétaires = violet…, voir `EspaceLayout`), et chaque `Card` sans `tone` explicite
 * la reprend — sans avoir à toucher aux ~150 cartes une par une. Une carte teintée remet le contexte à
 * `default` pour ses enfants : une carte imbriquée reste blanche et se détache de son parent coloré.
 */
const CardToneContext = React.createContext<CardTone>("default");

/** Teinte en cours (module ou carte parente) — pour les composants voisins qui s'y accordent (ex. `Table`). */
function useCardTone(): CardTone {
  return React.useContext(CardToneContext);
}

/** Liseré + bandeau d'en-tête d'un tableau posé directement sur la page, assortis à la teinte du module. */
const TABLE_TONES: Record<CardTone, { wrapper: string; head: string }> = {
  default: { wrapper: "border-border", head: "bg-surface-muted" },
  blue: { wrapper: "border-tint-blue-border", head: "bg-tint-blue-bg" },
  violet: { wrapper: "border-tint-violet-border", head: "bg-tint-violet-bg" },
  orange: { wrapper: "border-tint-orange-border", head: "bg-tint-orange-bg" },
  cyan: { wrapper: "border-tint-cyan-border", head: "bg-tint-cyan-bg" },
  teal: { wrapper: "border-tint-teal-border", head: "bg-tint-teal-bg" },
  amber: { wrapper: "border-tint-amber-border", head: "bg-tint-amber-bg" },
  rose: { wrapper: "border-tint-rose-border", head: "bg-tint-rose-bg" },
  slate: { wrapper: "border-tint-slate-border", head: "bg-tint-slate-bg" },
  success: { wrapper: "border-success-border", head: "bg-success-bg" },
  warning: { wrapper: "border-warning-border", head: "bg-warning-bg" },
  danger: { wrapper: "border-danger-border", head: "bg-danger-bg" },
  info: { wrapper: "border-info-border", head: "bg-info-bg" },
};

function CardToneProvider({ tone, children }: { tone: CardTone; children: React.ReactNode }) {
  return <CardToneContext.Provider value={tone}>{children}</CardToneContext.Provider>;
}

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Teinte de la carte ; absente = celle du module en cours (blanc hors espace connecté). */
  tone?: CardTone;
}

/** Carte / panneau — élévation niveau 1 de la charte (bordure hairline + shadow-sm), teintable. */
const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, tone, ...props }, ref) => {
  const inherited = React.useContext(CardToneContext);
  const resolved = tone ?? inherited;
  const card = <div ref={ref} className={cn("rounded-lg border shadow-sm", CARD_TONES[resolved], className)} {...props} />;
  // Les enfants d'une carte teintée repartent de blanc (cartes imbriquées, tableaux, encarts).
  return resolved === "default" ? card : <CardToneContext.Provider value="default">{card}</CardToneContext.Provider>;
});
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1 p-4 sm:p-5", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("font-display text-headline-sm text-ink", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-body-xs text-ink-muted", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 pt-0 sm:p-5 sm:pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center gap-2 border-t border-border p-4 sm:p-5", className)}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardToneProvider, useCardTone, TABLE_TONES, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
