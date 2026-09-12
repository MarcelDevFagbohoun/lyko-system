"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker PWA (mise en cache du shell pour un
 * chargement hors-ligne — section 2). La stratégie de synchronisation
 * complète IndexedDB ↔ MySQL est ajoutée à l'étape 11.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("Échec d'enregistrement du service worker", err);
      });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
