// Mandy service worker.
//
// Strategy, and why:
//   same-origin  → network-first, cache as fallback. Cache-first would serve a
//                  stale app.js every time you edit one during development; the
//                  network round trip to your own localhost costs nothing.
//   cross-origin → cache-first. The CDN URLs are version-pinned and immutable,
//                  and they are the heavy ones worth never re-fetching.
//   navigations  → never touched while there is a network. See the fetch
//                  listener; this one is a hosting constraint, not a caching
//                  preference.
//   /api/*       → never touched. Those are live file reads and writes.

const VERSION = "v1.31";
const SHELL_CACHE = `mandy-shell-${VERSION}`;
const RUNTIME_CACHE = `mandy-runtime-${VERSION}`;

// The app shell: everything needed to boot the editor with no network.
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/app.css",
  "/welcome.md",
  "/welcome-banner.png",
  "/welcome-banner-dark.png",
  "/toolbar.js",
  "/notify.js",
  "/lazy-load.js",
  "/markdown-style.js",
  "/app.js",
  "/undo.js",
  "/execcommand.js",
  "/outline.js",
  "/renderers.js",
  "/pdf-export.js",
  "/format-bar.js",
  "/static-export.js",
  "/html-export.js",
  "/tabs.js",
  "/file-api.js",
  "/theme-manager.js",
  "/docx-export.js",
  "/manifest.json",
  "/favicon.svg",
  "/favicon-32x32.png",
  "/favicon-192x192.png",
  "/favicon-512x512.png",
  "/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individual puts rather than addAll: one 404 should not void the install.
      await Promise.all(
        SHELL_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "reload" });
            if (res.ok) await cache.put(url, res);
          } catch {
            /* offline during install; runtime caching will fill this in */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => (keep.has(name) ? null : caches.delete(name))),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // The file API is live state — never cache it, never answer it from cache.
  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  // Navigations go to the network untouched whenever there is a network to go
  // to. Re-issuing one through fetch() drops Sec-Fetch-Mode from "navigate" to
  // "cors", and a host that reads that header to tell a page load from an XHR
  // then answers the page load as if it were an XHR. Behind Atrium that means a
  // bare 401 where the login redirect should have been: no login page, and no
  // document loaded to notice the 401 and go find one.
  //
  // navigator.onLine is trusted in the one direction it is reliable. False
  // means there is no network interface at all, so nothing is given up by
  // answering from cache. True means "maybe", and maybe goes to the network.
  // The gap that leaves is a reachable interface with an unreachable server —
  // a captive portal, the server down — where this used to boot the cached
  // shell and now shows the browser's own error page.
  if (request.mode === "navigate") {
    if (self.navigator.onLine) return;
    event.respondWith(offlineShell(request));
    return;
  }

  if (sameOrigin) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

// An offline navigation to any path should still boot the editor: the exact
// path if it was cached, the shell otherwise.
async function offlineShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const shell = await cache.match("/index.html");
  if (shell) return shell;
  return fetch(request);
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Opaque responses (no-cors CDN scripts) report status 0 but are usable.
  if (response.ok || response.type === "opaque") {
    cache.put(request, response.clone());
  }
  return response;
}
