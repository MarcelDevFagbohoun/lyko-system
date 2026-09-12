import type { Actor } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * Affiche « <verbe> <Nom> (<Rôle>) » — attribution d'une opération (création,
 * paiement, versement, état des lieux, plainte...) à son auteur. N'affiche
 * rien si l'auteur est inconnu (enregistrement antérieur à ce suivi), plutôt
 * que d'inventer une attribution.
 */
export function Attribution({ actor, verb, className }: { actor: Actor; verb: string; className?: string }) {
  if (!actor) return null;
  return (
    <span className={cn("text-body-xs text-ink-muted", className)}>
      {verb} {actor.name} ({actor.roleLabel})
    </span>
  );
}
