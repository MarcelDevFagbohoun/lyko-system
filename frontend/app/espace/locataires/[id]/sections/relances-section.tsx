"use client";

import * as React from "react";
import { listRelancesForLease, type Relance } from "@/lib/api/relances";
import { RelanceHistory } from "@/components/relances/relance-history";

/**
 * Historique complet des relances de ce bail (demande utilisateur, 2026-10-28) : loyer ET charges
 * SONEB/SBEE rattachées, dans un seul fil — « dans le dossier du locataire on doit avoir tous ces
 * détails des relances ». En lecture seule ici (l'envoi se fait depuis le Centre de relance) ; le
 * retour (réponse du locataire) reste ajoutable/modifiable depuis cette fiche.
 */
export function RelancesSection({ leaseId, accessToken }: { leaseId: number; accessToken: string | null }) {
  const [relances, setRelances] = React.useState<Relance[] | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    // Erreur avalée volontairement (droits insuffisants) : cette section reste simplement masquée
    // pour un employé sans accès au Centre de relance, comme les autres sections de cette fiche.
    listRelancesForLease(accessToken, leaseId)
      .then((res) => setRelances(res.relances))
      .catch(() => setRelances([]));
  }, [accessToken, leaseId]);

  React.useEffect(() => load(), [load]);

  if (relances !== null && relances.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">Relances envoyées</span>
      <RelanceHistory relances={relances} accessToken={accessToken} onChanged={load} />
    </div>
  );
}
