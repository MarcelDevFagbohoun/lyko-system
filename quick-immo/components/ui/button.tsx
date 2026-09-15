import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Bouton — charte Lyko System.
 * Variantes calquées sur la maquette (Primary / Secondary / Destructive / Ghost / WhatsApp).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-label-md transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover",
        // Boutons d'action (ouvrir un formulaire, déclencher une action) :
        // teintés et gras, jamais plats — mais distincts du bouton de
        // confirmation finale (`primary`, aplat plein) pour ne pas les
        // confondre quand les deux apparaissent dans le même écran (ex.
        // « Enregistrer un versement » puis « Confirmer le versement »).
        // `secondary` = action neutre/par défaut (réglages, export de
        // document, « créer le premier X » d'un écran vide) ; les variantes
        // teintées ci-dessous colorent par USAGE, cohérent avec le sens déjà
        // établi des couleurs de statut (succès/attention/risque/procédure) :
        //   - `success`  : un paiement/versement enregistré, un incident résolu.
        //   - `warning`  : signaler un problème, rouvrir quelque chose de validé.
        //   - `info`     : une écriture procédurale de routine (charge, dépense).
        //   - `danger`   : clôturer un mois — irréversible, jamais anodin.
        secondary:
          "bg-primary-bg text-primary font-semibold border border-primary-border hover:border-primary hover:bg-primary-border/60",
        success:
          "bg-success-bg text-success-fg font-semibold border border-success-border hover:border-success hover:bg-success-border/60",
        warning:
          "bg-warning-bg text-warning-fg font-semibold border border-warning-border hover:border-warning hover:bg-warning-border/60",
        info: "bg-info-bg text-info-fg font-semibold border border-info-border hover:border-info hover:bg-info-border/60",
        danger:
          "bg-danger-bg text-danger-fg font-semibold border border-danger-border hover:border-danger hover:bg-danger-border/60",
        destructive: "bg-danger text-white shadow-sm hover:bg-danger-hover",
        ghost: "text-ink-soft hover:bg-surface-muted",
        whatsapp: "bg-whatsapp text-white shadow-sm hover:opacity-90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-3 text-body-sm",
        md: "h-10 px-4",
        lg: "h-11 px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
