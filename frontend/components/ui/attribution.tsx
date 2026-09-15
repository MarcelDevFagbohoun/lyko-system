import type { Actor } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * Affiche « <verbe> <Nom> (<Rôle>) le <date> » — attribution d'une opération
 * (création, paiement, versement, état des lieux, plainte...) à son auteur
 * ET à sa date (toute opération sur la plateforme doit être datée, pas
 * seulement attribuée). N'affiche rien si l'auteur est inconnu
 * (enregistrement antérieur à ce suivi), plutôt que d'inventer une
 * attribution. `at` accepte une date ISO complète (colonne DATETIME) ou
 * juste "AAAA-MM-JJ" ; omise si l'appelant n'a pas encore cette donnée.
 */
export function Attribution({
  actor,
  verb,
  at,
  className,
}: {
  actor: Actor;
  verb: string;
  at?: string | null;
  className?: string;
}) {
  if (!actor) return null;
  const dateLabel = at
    ? new Date(at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;
  return (
    <span className={cn("text-body-xs text-ink-muted", className)}>
      {verb} {actor.name} ({actor.roleLabel}){dateLabel ? ` le ${dateLabel}` : ""}
    </span>
  );
}
