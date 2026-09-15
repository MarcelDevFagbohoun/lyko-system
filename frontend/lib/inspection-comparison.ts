import type { InspectionReport } from "@/lib/api/renters";
import { CONDITION_RANK, type InspectionCondition } from "@/lib/constants/inspection";

export type ItemComparisonStatus = "degraded" | "improved" | "same" | "unrated" | "added" | "removed";

export type ItemComparison = {
  zoneKey: string;
  zoneLabel: string;
  itemKey: string;
  itemLabel: string;
  moveInCondition: InspectionCondition | null;
  moveOutCondition: InspectionCondition | null;
  status: ItemComparisonStatus;
};

/**
 * Compare une fiche d'entrée et de sortie élément par élément (étape 13,
 * idée n°9) — utile pour justifier une éventuelle retenue sur la caution.
 * Échelle ORDONNÉE (décision produit) : BE > SR > ME ; une dégradation est
 * un état de sortie strictement inférieur à l'état d'entrée sur cette
 * échelle. Postes ajoutés/retirés entre les deux fiches (zone/élément
 * personnalisé) : signalés à part, jamais fondus dans « inchangé ».
 */
export function compareInspectionReports(moveIn: InspectionReport, moveOut: InspectionReport): ItemComparison[] {
  const moveInIndex = new Map<string, { zoneLabel: string; itemLabel: string; condition: InspectionCondition | null }>();
  for (const zone of moveIn.zones) {
    for (const item of zone.items) {
      moveInIndex.set(`${zone.key}::${item.key}`, { zoneLabel: zone.label, itemLabel: item.label, condition: item.condition });
    }
  }

  const results: ItemComparison[] = [];
  const seen = new Set<string>();

  for (const zone of moveOut.zones) {
    for (const item of zone.items) {
      const mapKey = `${zone.key}::${item.key}`;
      seen.add(mapKey);
      const entry = moveInIndex.get(mapKey);
      const moveInCondition = entry?.condition ?? null;
      const moveOutCondition = item.condition;

      let status: ItemComparisonStatus;
      if (!entry) {
        status = "added";
      } else if (!moveOutCondition || !moveInCondition) {
        status = "unrated";
      } else if (CONDITION_RANK[moveOutCondition] < CONDITION_RANK[moveInCondition]) {
        status = "degraded";
      } else if (CONDITION_RANK[moveOutCondition] > CONDITION_RANK[moveInCondition]) {
        status = "improved";
      } else {
        status = "same";
      }

      results.push({
        zoneKey: zone.key,
        zoneLabel: zone.label,
        itemKey: item.key,
        itemLabel: item.label,
        moveInCondition,
        moveOutCondition,
        status,
      });
    }
  }

  // Postes présents à l'entrée mais absents de la fiche de sortie (rare : ne
  // devrait arriver que si la sortie a été démarrée avant l'ajout d'un
  // élément personnalisé à l'entrée, ou modifiée manuellement) — signalés
  // plutôt que silencieusement ignorés.
  for (const [mapKey, entry] of moveInIndex) {
    if (seen.has(mapKey)) continue;
    const [zoneKey, itemKey] = mapKey.split("::");
    results.push({
      zoneKey,
      zoneLabel: entry.zoneLabel,
      itemKey,
      itemLabel: entry.itemLabel,
      moveInCondition: entry.condition,
      moveOutCondition: null,
      status: "removed",
    });
  }

  return results;
}
