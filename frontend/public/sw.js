/*
 * Service worker Africa Immo Management — shell applicatif (étape 0) +
 * notifications push navigateur (étape push, Web Push API).
 *
 * Rôle limité au shell (navigations + assets statiques) : rendre l'appli
 * chargeable hors-ligne. Les données métier (lecture) et la file d'écriture
 * hors-ligne (étape 11 — paiement de loyer, plainte, liste blanche
 * explicite) vivent côté application, dans IndexedDB via `lib/offline/`
 * (`db.ts`, `queue.ts`) — jamais dans ce service worker, volontairement :
 * ça reste au plus près de `apiFetch` où l'authentification et les erreurs
 * applicatives sont déjà gérées, pas dans un intercepteur réseau générique.
 *
 * Les événements `push`/`notificationclick` vivent ICI (et pas dans un
 * second service worker) : un seul SW peut contrôler une portée donnée —
 * en créer un second désenregistrerait celui-ci.
 */
const VERSION = "v0.1.0";
const SHELL_CACHE = `aim-shell-${VERSION}`;
const ASSET_CACHE = `aim-assets-${VERSION}`;

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

// Notification push reçue (même onglet fermé) : le serveur envoie un JSON
// { title, body, url, tag } — voir backend/src/services/push/sendPush.js.
self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }
  const title = data.title || "Africa Immo Management";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon.svg",
      badge: "/icons/icon.svg",
      tag: data.tag,
      data: { url: data.url || "/espace" },
    }),
  );
});

// Clic sur la notification : focaliser un onglet déjà ouvert sur la bonne
// page, sinon en ouvrir un nouveau.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/espace";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    }),
  );
});
