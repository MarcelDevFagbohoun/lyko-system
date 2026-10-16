"use client";

import * as React from "react";
import { getTenantRhythm, type TenantRhythm } from "@/lib/api/accounting";

/**
 * Rythme de période du tenant (étape 2b/5, 2026-10-16) — un seul appel, résultat quasi-statique
 * pour la session (change rarement, jamais en cours de remplissage d'un formulaire). Utilisé pour
 * décider quel champ d'échéance de loyer afficher à la création d'un bail (`RentDueField`).
 */
export function useTenantRhythm(accessToken: string | null) {
  const [rhythm, setRhythm] = React.useState<TenantRhythm | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    getTenantRhythm(accessToken)
      .then(setRhythm)
      .catch(() => {
        // Non bloquant : à défaut, les formulaires retombent sur le comportement calendaire
        // historique (voir `RentDueField`), jamais une erreur affichée pour un simple échec réseau.
      });
  }, [accessToken]);

  return { rhythm, loading: rhythm === null };
}
