import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

/**
 * Carte statistique (KPI) — libellé en label-sm, valeur en currency-display,
 * pastille de tendance optionnelle. Gabarit unique pour tous les tableaux de
 * bord (comptabilité, DG) et l'aperçu produit de la landing.
 *
 * `tone` colore TOUTE la carte, pas seulement le chiffre : sur un tableau de
 * bord, la nature d'une valeur (favorable / à surveiller / préoccupante) se
 * lit d'un coup d'œil dans la grille. Rendu franc — aplat plein vert / jaune
 * / rouge (`*-strong`) sur texte blanc, puce d'icône dépolie — mais tenu :
 * teintes assez sombres pour un contraste AA, léger `ring` et `shadow-sm`
 * pour un rendu net. `tone="default"` reste une carte blanche neutre, pour un
 * chiffre purement informatif. Toujours combiné à l'icône + au libellé,
 * jamais la couleur seule (mêmes tokens `success`/`warning`/`danger`/`info`
 * que les Badge — sémantique constante, voir charte graphique).
 */
interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** ex. "FCFA" ou "%" — rendu en petit à côté de la valeur. */
  unit?: string;
  icon?: React.ReactNode;
  trend?: { value: string; direction: "up" | "down" | "flat" };
  tone?: "default" | "success" | "warning" | "danger" | "info";
  className?: string;
}

type ToneStyle = { card: string; label: string; chip: string; value: string; unit: string; trend: string };

const NEUTRAL: ToneStyle = {
  card: "border-border bg-surface",
  label: "text-ink-muted",
  chip: "bg-surface-muted text-primary",
  value: "text-ink",
  unit: "text-ink-muted",
  trend: "text-ink-muted",
};

// Aplat plein + texte blanc : le rendu « franc » demandé pour les tuiles de dashboard.
const solid = (bg: string): ToneStyle => ({
  card: `border-transparent ${bg} text-white shadow-sm ring-1 ring-black/5`,
  label: "font-semibold text-white/85",
  chip: "bg-white/15 text-white",
  value: "text-white",
  unit: "text-white/70",
  trend: "text-white/85",
});

const toneStyles: Record<NonNullable<StatCardProps["tone"]>, ToneStyle> = {
  default: NEUTRAL,
  success: solid("bg-success-strong"),
  warning: solid("bg-warning-strong"),
  danger: solid("bg-danger-strong"),
  info: solid("bg-info-fg"),
};

// Coloration des flèches ▲/▼ sur une carte neutre uniquement (sur un aplat
// plein, la tendance reste blanche pour rester lisible).
const neutralTrendTone: Record<NonNullable<StatCardProps["trend"]>["direction"], string> = {
  up: "text-success-fg",
  down: "text-danger-fg",
  flat: "text-ink-muted",
};

export function StatCard({ label, value, unit, icon, trend, tone = "default", className }: StatCardProps) {
  const s = toneStyles[tone];
  const trendColor = tone === "default" ? neutralTrendTone[trend?.direction ?? "flat"] : s.trend;

  return (
    <Card className={cn("flex flex-col justify-between p-4 transition-colors sm:p-5", s.card, className)}>
      <div className="flex items-start justify-between gap-3">
        <span className={cn("font-label-sm uppercase tracking-wider", s.label)}>{label}</span>
        {icon && <span className={cn("rounded-md p-2", s.chip)}>{icon}</span>}
      </div>

      <div className="mt-3 flex items-end gap-1.5">
        <span className={cn("tabular font-display text-currency-display tracking-tight", s.value)}>{value}</span>
        {unit && <span className={cn("pb-0.5 text-body-sm", s.unit)}>{unit}</span>}
      </div>

      {trend && (
        <div className={cn("mt-3 flex items-center gap-1 text-body-xs", trendColor)}>
          {trend.direction !== "flat" && <span aria-hidden>{trend.direction === "up" ? "▲" : "▼"}</span>}
          <span className="font-semibold">{trend.value}</span>
        </div>
      )}
    </Card>
  );
}
