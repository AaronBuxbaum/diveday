const CACHE_NAME = "diveday-offline-manifest-shell-v1";
const OFFLINE_SHELL = "/offline-manifest";
// Matches the live, authenticated roll-call page this shell backs up —
// never any other /shop route — so a captain who reloads mid-departure with
// no signal lands on their saved device copy instead of the browser's own
// offline error, without this worker reaching beyond the manifest.
const LIVE_MANIFEST_PATTERN = /^\/shop\/[^/]+\/trips\/([^/]+)\/manifest(?:\/.*)?$/;

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

  if (event.request.mode === "navigate") {
    const liveManifestMatch = url.pathname.match(LIVE_MANIFEST_PATTERN);
    if (liveManifestMatch) {
      const tripId = liveManifestMatch[1];
      event.respondWith(
        // Network-first: the live manifest is never served from cache — this
        // only ever substitutes the device's own offline copy, and only once
        // the network genuinely fails.
        fetch(event.request).catch(async () => {
          const cachedShell = await caches.match(OFFLINE_SHELL);
          if (!cachedShell) return Response.error();
          return Response.redirect(`${OFFLINE_SHELL}?trip=${encodeURIComponent(tripId)}`, 302);
        }),
      );
      return;
    }
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
