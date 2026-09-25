"use client";

import * as React from "react";
import { newIdempotencyKey } from "@/lib/utils";

/**
 * Clé d'idempotence d'un formulaire d'enregistrement d'argent (étape 36) : une clé par envoi,
 * générée à l'ouverture du formulaire. À joindre à la requête ; `renew()` après chaque
 * enregistrement RÉUSSI (un formulaire resté monté sert à enregistrer plusieurs opérations
 * distinctes — chacune doit avoir sa propre clé). Après un échec, on garde la même clé :
 * réessayer est sans risque, le serveur ne consomme la clé que si l'opération est enregistrée.
 */
export function useIdempotencyKey() {
  const [key, setKey] = React.useState(() => newIdempotencyKey());
  const renew = React.useCallback(() => setKey(newIdempotencyKey()), []);
  return { key, renew };
}
