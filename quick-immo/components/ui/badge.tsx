import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Pastille de statut — pleine capsule (rounded-full), 12px, medium, majuscules.
 * Les statuts métier utilisent EXCLUSIVEMENT ces variantes pour rester cohérents
 * sur toute la plateforme (vert = à jour/payé, rouge = retard/impayé, orange = en cours).
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-label-sm uppercase tracking-[0.025em]",
  {
    variants: {
      variant: {
        neutral: "border-border bg-surface-muted text-ink-soft",
        success: "border-success-border bg-success-bg text-success-fg",
        warning: "border-warning-border bg-warning-bg text-warning-fg",
        danger: "border-danger-border bg-danger-bg text-danger-fg",
        info: "border-info-border bg-info-bg text-info-fg",
        primary: "border-transparent bg-primary text-primary-fg",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Affiche une pastille ronde de couleur avant le libellé. */
  dot?: boolean;
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
