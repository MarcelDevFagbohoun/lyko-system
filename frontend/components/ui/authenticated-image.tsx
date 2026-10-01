"use client";

import * as React from "react";
import { API_URL } from "@/lib/api/client";

/**
 * <img> pour un fichier protégé (`/api/files/...`, audit sécurité étape 49) :
 * un simple `src` HTML ne peut pas porter l'en-tête Authorization, donc on
 * récupère le fichier en blob puis on affiche une URL objet locale — même
 * principe que `openAuthenticatedPdf` (lib/api/client.ts), adapté à un
 * affichage inline plutôt qu'un nouvel onglet. `src` accepte soit une URL
 * déjà complète, soit juste le chemin renvoyé par l'API (`/api/files/...`) —
 * ou un `blob:`/`data:` (ex. aperçu local d'un fichier pas encore envoyé,
 * via `URL.createObjectURL`/`FileReader`) : affiché tel quel, sans fetch,
 * puisqu'il ne pointe déjà vers rien qui exige une authentification.
 */
export function AuthenticatedImage({
  src,
  accessToken,
  alt,
  className,
  fallback = null,
}: {
  src: string;
  accessToken: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;
    setFailed(false);
    setObjectUrl(null);

    if (src.startsWith("blob:") || src.startsWith("data:")) {
      setObjectUrl(src);
      return;
    }

    const url = src.startsWith("http") ? src : `${API_URL}${src}`;
    fetch(url, { credentials: "include", headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (cancelled) return;
        currentUrl = URL.createObjectURL(blob);
        setObjectUrl(currentUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [src, accessToken]);

  if (failed) return <>{fallback}</>;
  if (!objectUrl) return <div className={className} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={objectUrl} alt={alt} className={className} />;
}
