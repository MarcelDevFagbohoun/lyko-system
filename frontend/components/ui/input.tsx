import * as React from "react";
import { cn } from "@/lib/utils";

/** Champ de saisie — hauteur 38px, bordure border-strong, focus ring primaire (charte). */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink",
        "placeholder:text-ink-faint",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-body-sm file:font-medium",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

/** Bloc label + champ + message d'aide/erreur, gabarit commun à tous les formulaires. */
interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-label-sm text-ink-soft">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-body-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-body-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export { Input, Field };
