const CACHE_NAME = "diveday-offline-manifest-shell-v1";
const OFFLINE_SHELL = "/offline-manifest";
// Matches the live, authenticated roll-call page this shell backs up —
// never any other /shop route — so a captain who reloads mid-departure with
// no signal lands on their saved device copy instead of the browser's own
// offline error, without this worker reaching beyond the manifest.
const LIVE_MANIFEST_PATTERN = /^\/shop\/[^/]+\/trips\/([^/]+)\/manifest(?:\/.*)?$/;

async function cacheOfflineShell() {
  const response = await fetch(OFFLINE_SHELL, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Offline manifest shell could not be loaded");
  const html = await response.clone().text();
  const assetPaths = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"#?]*\/_next\/static\/[^"?#]+)"/g)) {
    assetPaths.add(new URL(match[1], self.location.origin).pathname);
  }
  // Fetch the shell and every asset it references before writing anything.
  // This now runs automatically (not just on an explicit "Save for offline"
  // click), so a mid-fetch failure — a deploy landing between requests, a
  // flaky connection — must never partially overwrite an already-working
  // offline copy with new HTML pointing at assets that were never cached.
  const assetEntries = await Promise.all(
    [...assetPaths].map(async (asset) => {
      const assetResponse = await fetch(asset);
      if (!assetResponse.ok) {
        throw new Error(`Offline manifest asset ${asset} could not be loaded`);
      }
      return [asset, assetResponse];
    }),
  );
  const cache = await caches.open(CACHE_NAME);
  // Assets before the shell that references them: a cache write can still
  // fail on its own (storage quota, eviction) even after every fetch
  // succeeded. Writing leaves last means that failure aborts before the
  // shell HTML is replaced, so the previous — still fully self-consistent —
  // shell and asset set keep serving instead of a new document pointing at
  // bundles that were never actually written.
  await Promise.all(assetEntries.map(([asset, assetResponse]) => cache.put(asset, assetResponse)));
  await cache.put(OFFLINE_SHELL, response);
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
          const redirectTarget = new URL(OFFLINE_SHELL, self.location.origin);
          redirectTarget.searchParams.set("trip", tripId);
          // Carries the checkpoint a captain was on (e.g. "after_dive_1") so a
          // reload mid roll call doesn't drop them back to "Before departure".
          const checkpoint = url.searchParams.get("checkpoint");
          if (checkpoint) redirectTarget.searchParams.set("checkpoint", checkpoint);
          return Response.redirect(redirectTarget.href, 302);
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
