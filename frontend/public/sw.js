/*
 * Service worker Lyko System — shell applicatif (étape 0).
 *
 * Rôle limité au shell (navigations + assets statiques) : rendre l'appli
 * chargeable hors-ligne. Les données métier (lecture) et la file d'écriture
 * hors-ligne (étape 11 — paiement de loyer, plainte, liste blanche
 * explicite) vivent côté application, dans IndexedDB via `lib/offline/`
 * (`db.ts`, `queue.ts`) — jamais dans ce service worker, volontairement :
 * ça reste au plus près de `apiFetch` où l'authentification et les erreurs
 * applicatives sont déjà gérées, pas dans un intercepteur réseau générique.
 */
const VERSION = "v0.1.0";
const SHELL_CACHE = `lyko-shell-${VERSION}`;
const ASSET_CACHE = `lyko-assets-${VERSION}`;

const SHELL_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Ne jamais intercepter les appels d'API (autre origine / port 4000) :
  // le cache de lecture et la file d'écriture hors-ligne (étape 11) sont
  // gérés dans `apiFetch` (lib/api/client.ts), pas ici.
  if (url.origin !== self.location.origin) return;

  // Navigations : réseau d'abord, repli sur la dernière page connue puis offline.html.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/offline.html");
        }),
    );
    return;
  }

  // Assets statiques Next (_next/static, icônes, polices) : stale-while-revalidate.
  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
