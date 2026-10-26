/**
 * Règles d'affichage de la page Abonnement (pures, sans appel réseau). Le serveur reste la source de vérité :
 * il refuse de toute façon une offre inférieure pendant un abonnement actif (`quote`, services/billing.js).
 */

/** Lien entre une offre du catalogue et l'offre en cours. */
export type PlanRelation = "none" | "current" | "upgrade" | "downgrade";

/**
 * `orderedKeys` : clés des offres de la moins chère à la plus complète (ordre du catalogue).
 * `currentKey` : offre active, ou null (aucun abonnement actif → « none », tout est « Choisir »).
 */
export function planRelation(orderedKeys: readonly string[], currentKey: string | null, planKey: string): PlanRelation {
  if (!currentKey) return "none";
  const current = orderedKeys.indexOf(currentKey);
  const target = orderedKeys.indexOf(planKey);
  if (current === -1 || target === -1) return "none";
  if (target === current) return "current";
  return target > current ? "upgrade" : "downgrade";
}

/** Libellé du bouton d'une carte d'offre selon sa relation à l'offre en cours. */
export function planActionLabel(relation: PlanRelation, planLabel: string): string {
  switch (relation) {
    case "current":
      return "Renouveler";
    case "upgrade":
      return `Passer à ${planLabel}`;
    case "downgrade":
      return "Disponible à l'échéance";
    default:
      return `Choisir ${planLabel}`;
  }
}

/** Part du temps restant dans la période payée (0 à 1) — approximation : un mois = 30 jours. */
export function remainingRatio(daysLeft: number | null, periodMonths: number | null): number | null {
  if (daysLeft === null || !periodMonths) return null;
  return Math.max(0, Math.min(1, daysLeft / (periodMonths * 30)));
}

/** « 50 unités · 10 propriétaires · 2 utilisateurs » ; une limite absente se lit « Unités illimitées ». */
export function limitsSummary(limits: { units: number | null; owners: number | null; users: number | null }): string {
  const part = (n: number | null, one: string, many: string, unlimited: string) => (n === null ? unlimited : `${n} ${n > 1 ? many : one}`);
  return [
    part(limits.units, "unité", "unités", "Unités illimitées"),
    part(limits.owners, "propriétaire", "propriétaires", "Propriétaires illimités"),
    part(limits.users, "utilisateur", "utilisateurs", "Utilisateurs illimités"),
  ].join(" · ");
}
