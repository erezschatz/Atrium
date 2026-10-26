const CACHE = 'domo-v1.10';
const STATIC = ['/app.js', '/style.css', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // API requests and navigations go to the network natively.
  // Intercepting navigations via fetch() changes Sec-Fetch-Mode from
  // 'navigate' to 'cors', which breaks server-side auth detection.
  if (e.request.url.includes('/api/') || e.request.mode === 'navigate') {
    return;
  }

  // Static assets: cache-first, fallback to network
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
