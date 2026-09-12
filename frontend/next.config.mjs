import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Origine de l'API (pour autoriser les appels XHR et le chargement des
// logos/cachets servis par Express dans la CSP). Dérivée de la même variable
// que le client fetch — une seule source de vérité.
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").origin;
  } catch {
    return "";
  }
})();

const isProd = process.env.NODE_ENV === "production";

// CSP appliquée en production uniquement : en dev, le rechargement à chaud
// (websocket, eval) et l'API en http nu la feraient échouer.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Next injecte des scripts/styles inline (bootstrap d'hydratation, données
  // RSC). Sans infrastructure de nonce, 'unsafe-inline' reste nécessaire ;
  // le passage à une CSP à nonce est noté comme évolution (étape 12).
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${apiOrigin ? ` ${apiOrigin}` : ""}`,
  "font-src 'self'",
  `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  // Uniquement quand l'API est en HTTPS : sinon (`next start` local contre une
  // API http://localhost) cette directive ferait échouer tous les appels.
  ...(apiOrigin.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Build autonome : `.next/standalone` embarque un serveur minimal + seules
  // les dépendances utiles — image Docker légère (étape 12b). Sans effet sur
  // `next dev`.
  output: "standalone",

  // Le dépôt contient plusieurs package-lock.json (racine monorepo + backend +
  // frontend, + parfois un ~/package-lock.json parasite) : sans indication,
  // Next 15 remonte trop haut pour choisir la racine de traçage. On la fixe
  // sur le dossier frontend (appli Next autonome, aucune dépendance partagée
  // hors de ce dossier) — garde aussi la sortie `standalone` à plat.
  outputFileTracingRoot: __dirname,

  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      // Forcer HTTPS 2 ans, sous-domaines inclus. Sans effet en http local,
      // honoré dès que le reverse-proxy TLS (étape 12b) sert le site.
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ...(isProd ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] : []),
    ];
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Le service worker doit pouvoir contrôler toute l'origine et ne pas être mis en cache.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
