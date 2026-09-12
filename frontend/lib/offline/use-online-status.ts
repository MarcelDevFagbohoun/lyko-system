"use client";

import * as React from "react";

/**
 * Étape 11 — statut réseau réactif, pour désactiver côté UI les actions qui
 * exigent le serveur (création d'une fiche à code auto-généré : bien,
 * locataire, bail, propriétaire, employé...) plutôt que de laisser
 * l'utilisateur remplir un formulaire qui échouera silencieusement.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = React.useState(true);

  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
