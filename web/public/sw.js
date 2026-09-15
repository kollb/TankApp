/* TankApp Service Worker: App-Shell offline, API-Antworten max. 30 Min. als
   gekennzeichneter Notstand. Niemals Preise erfinden — nur cachen.
   Die Shell-Version ist die **App-Version** (beim Build gestempelt, B10): Ein
   GUI-Update bekommt damit einen neuen Cache-Namen und meldet sich beim
   wartenden Worker an die Ansicht („Neue Version verfügbar“) — statt eines
   festen „…-v1“, das eine alte Shell unsichtbar weiterlaufen ließ. */
const VERSION = "__APP_VERSION__";
const SHELL = `tankapp-shell-${VERSION}`;
const API = "tankapp-api-v1";
const API_MAX_AGE_MS = 30 * 60 * 1000;

self.addEventListener("install", (event) => {
  // Kein automatisches skipWaiting (B10): Die neue Shell wartet, bis die
  // Ansicht sie anfordert — sonst tauscht sie sich mitten im Betrieb unter
  // der laufenden Seite aus, ohne dass jemand davon erfährt.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(["/", "/manifest.json", "/icon.svg"])),
  );
});

// B10: „Neu laden“ in der Ansicht fordert die Übernahme an; die Version
// beantwortet die Frage, welcher Stand dort läuft.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "VERSION" && event.source) {
    event.source.postMessage({ type: "VERSION", version: VERSION });
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHELL && k !== API).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    // Stale-while-revalidate mit Altersgrenze: An der Säule mit schlechtem
    // Netz lieber den letzten Stand als nichts — die GUI zeigt das Alter.
    event.respondWith(
      caches.open(API).then(async (cache) => {
        const cached = await cache.match(request);
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) {
              const stamped = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: new Headers(response.headers),
              });
              stamped.headers.set("x-tankapp-cached-at", String(Date.now()));
              cache.put(request, stamped.clone());
            }
            return response;
          })
          .catch(() => null);
        if (cached) {
          const age = Date.now() - Number(cached.headers.get("x-tankapp-cached-at") || 0);
          if (Number.isFinite(age) && age < API_MAX_AGE_MS) {
            event.waitUntil(fresh);
            return cached;
          }
        }
        const network = await fresh;
        return network || cached || Response.error();
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && request.destination !== "document") {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
