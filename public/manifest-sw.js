const CACHE_NAME = "diveday-offline-manifest-shell-v1";
const OFFLINE_SHELL = "/offline-manifest";

async function cacheOfflineShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(OFFLINE_SHELL, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Offline manifest shell could not be loaded");
  await cache.put(OFFLINE_SHELL, response.clone());
  const html = await response.text();
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"#?]*\/_next\/static\/[^"?#]+)"/g)) {
    assets.add(new URL(match[1], self.location.origin).pathname);
  }
  await Promise.all(
    [...assets].map(async (asset) => {
      const assetResponse = await fetch(asset);
      if (assetResponse.ok) await cache.put(asset, assetResponse);
    }),
  );
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(cacheOfflineShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) => key.startsWith("diveday-offline-manifest-shell-") && key !== CACHE_NAME,
              )
              .map((key) => caches.delete(key)),
          ),
        ),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_OFFLINE_MANIFEST_SHELL") {
    event.waitUntil(cacheOfflineShell());
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;

  if (event.request.mode === "navigate" && url.pathname === OFFLINE_SHELL) {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response.ok) (await caches.open(CACHE_NAME)).put(OFFLINE_SHELL, response.clone());
          return response;
        })
        .catch(async () => (await caches.match(OFFLINE_SHELL)) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then(async (cached) => {
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) (await caches.open(CACHE_NAME)).put(event.request, response.clone());
        return response;
      }),
    );
  }
});
