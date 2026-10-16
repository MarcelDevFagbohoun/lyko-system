import * as React from "react";
import { cn } from "@/lib/utils";

export type BarSegment = { value: number; className: string; label: string };

/**
 * Barre de progression à plusieurs segments (part de chaque catégorie dans un
 * total). Un segment nul disparaît ; la barre entière se lit aussi au lecteur
 * d'écran (`aria-label`), la couleur n'est jamais seule à porter l'information.
 */
export function SegmentedBar({ segments, ariaLabel }: { segments: BarSegment[]; ariaLabel: string }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  return (
    <div role="img" aria-label={ariaLabel} className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted">
      {/* Étape 55 (partie Biens) : la barre se remplit de gauche à droite à l'affichage. */}
      <div className="flex h-full w-full origin-left animate-bar-grow">
      {total > 0 &&
        segments
          .filter((x) => x.value > 0)
          .map((x) => (
            <div
              key={x.label}
              title={x.label}
              className={cn("h-full transition-[width]", x.className)}
              style={{ width: `${(x.value / total) * 100}%` }}
            />
          ))}
      </div>
    </div>
  );
}
