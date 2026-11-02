/**
 * Préparation du mode hors-ligne (étape 11, extension) — précharge dans le
 * cache de lecture (`cacheGet`/`cachePut`, via `apiFetch`) les pages dont un
 * agent a besoin AVANT de partir sur le terrain sans réseau : les listes
 * générales (biens, factures, plaintes en cours, retards) puis la fiche de
 * chaque locataire de son portefeuille. Sans ce bouton, le cache ne
 * contenait que ce que l'agent avait déjà visité par hasard — ce qui ne
 * couvre jamais tout le portefeuille avant un déplacement.
 *
 * Limite assumée : seule la fiche PRINCIPALE de chaque locataire est
 * préchargée (bail actif, montants, loyers déjà réglés) — les onglets qui
 * font leur propre appel réseau à l'ouverture (historique complet des
 * charges, des relances, des plaintes d'UN bail précis) ne le sont PAS :
 * multiplier les requêtes par bail par type d'historique serait
 * disproportionné pour un usage raisonnable de la bande passante/quota
 * IndexedDB. Ces onglets-là resteront indisponibles hors-ligne.
 */

import { listRenters, getRenter } from "@/lib/api/renters";
import { listProperties } from "@/lib/api/properties";
import { listCharges } from "@/lib/api/charges";
import { listComplaints } from "@/lib/api/complaints";
import { listPortfolioArrears, listUtilityArrears, listPredictiveAlerts } from "@/lib/api/accounting";

export type PrepareProgress = { done: number; total: number; label: string };

const RENTER_FETCH_CONCURRENCY = 4;

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      // Une fiche en échec (locataire supprimé entre-temps, etc.) n'arrête jamais les autres.
      await fn(items[i]).catch(() => {});
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Précharge l'essentiel du portefeuille accessible à l'utilisateur connecté
 * (déjà filtré côté serveur par rôle/portée agent, comme pour un visite
 * normale de ces pages). `onProgress` est appelé à chaque étape, pour
 * afficher une barre de progression dans l'UI.
 */
export async function prepareOfflineMode(
  accessToken: string,
  onProgress?: (p: PrepareProgress) => void,
): Promise<{ renterCount: number }> {
  const generalSteps: Array<() => Promise<unknown>> = [
    () => listProperties(accessToken),
    () => listCharges(accessToken),
    () => listComplaints(accessToken, { status: "non_resolue" }),
    () => listPortfolioArrears(accessToken),
    () => listUtilityArrears(accessToken),
    () => listPredictiveAlerts(accessToken),
  ];

  let done = 0;
  const totalBeforeRenters = generalSteps.length + 1; // +1 : la liste des locataires elle-même
  onProgress?.({ done, total: totalBeforeRenters, label: "Listes générales…" });

  for (const step of generalSteps) {
    await step().catch(() => {});
    done++;
    onProgress?.({ done, total: totalBeforeRenters, label: "Listes générales…" });
  }

  const { renters } = await listRenters(accessToken);
  done++;

  const total = totalBeforeRenters + renters.length;
  let rentersDone = 0;
  onProgress?.({ done, total, label: `Fiches locataires (0/${renters.length})…` });

  await mapWithConcurrency(renters, RENTER_FETCH_CONCURRENCY, async (r) => {
    await getRenter(accessToken, r.id);
    rentersDone++;
    onProgress?.({ done: done + rentersDone, total, label: `Fiches locataires (${rentersDone}/${renters.length})…` });
  });

  return { renterCount: renters.length };
}
