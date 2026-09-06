// TankApp PWA Service Worker (Concept v4, Review O5)
// Implements Cache-First for Forecasts (30m) & Stale-While-Revalidate for Stations & Heatmaps

const CACHE_NAME = "tankapp-cache-v4";
const FORECAST_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Cache-first strategy for forecast and decision endpoints
  if (url.pathname.includes("/forecast") || url.pathname.includes("/decision")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          const fetchDate = cachedResponse.headers.get("x-sw-cache-time");
          if (fetchDate && Date.now() - parseInt(fetchDate, 10) < FORECAST_MAX_AGE_MS) {
            return cachedResponse;
          }
        }
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse.ok) {
            const headers = new Headers(networkResponse.headers);
            headers.set("x-sw-cache-time", Date.now().toString());
            const clonedBlob = await networkResponse.clone().blob();
            const responseToCache = new Response(clonedBlob, {
              status: networkResponse.status,
              statusText: networkResponse.statusText,
              headers,
            });
            await cache.put(event.request, responseToCache);
          }
          return networkResponse;
        } catch {
          if (cachedResponse) return cachedResponse;
          return new Response(JSON.stringify({ offline: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }
      })
    );
    return;
  }

  // Stale-While-Revalidate for stations, heatmaps, and static assets
  if (
    url.pathname.startsWith("/v1/") ||
    url.pathname.startsWith("/api/v1/") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".json")
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.ok) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
});
