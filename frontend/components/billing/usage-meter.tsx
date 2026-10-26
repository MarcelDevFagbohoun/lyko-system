import { cn } from "@/lib/utils";

/**
 * Jauge de consommation d'une limite d'offre (unités, propriétaires, utilisateurs).
 * Sans limite (`max === null`) : on affiche seulement le compte. La couleur ne porte jamais seule
 * l'information : le texte « 12 / 50 » et l'aria-label disent la même chose.
 */
export function UsageMeter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const ratio = max ? used / max : 0;
  const tone = max === null ? "bg-primary" : ratio > 1 ? "bg-danger-fg" : ratio >= 0.8 ? "bg-warning-fg" : "bg-primary";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body-sm text-ink-soft">{label}</span>
        <span className={cn("font-label-md", ratio > 1 ? "text-danger-fg" : "text-ink")}>
          {used} / {max === null ? "illimité" : max}
        </span>
      </div>
      {max !== null && (
        <div
          role="progressbar"
          aria-label={`${label} : ${used} sur ${max}`}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={Math.min(used, max)}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        >
          <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
