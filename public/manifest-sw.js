// Bump the trailing "-v<n>" on a deploy that changes the offline shell, and
// bump `OFFLINE_MANIFEST_SHELL_VERSION` in src/lib/offline-manifests.ts to
// match — this file is static and outside the Next.js build, so it can't
// import that constant; the two are compared at runtime instead
// (`getActiveOfflineShellVersion`) to tell a crew member holding a copy of
// this worker from an older deploy, rather than serving it with no signal
// anything's stale (task 124 / persona 15, Leo).
const CACHE_NAME = "diveday-offline-manifest-shell-v2";
const SHELL_VERSION = CACHE_NAME.slice(CACHE_NAME.lastIndexOf("-v") + 1);
const OFFLINE_SHELL = "/offline-manifest";
// Matches the live, authenticated roll-call page this shell backs up —
// never any other /shop route — so a captain who reloads mid-departure with
// no signal lands on their saved device copy instead of the browser's own
// offline error, without this worker reaching beyond the manifest.
const LIVE_MANIFEST_PATTERN = /^\/shop\/[^/]+\/trips\/([^/]+)\/manifest(?:\/.*)?$/;

/**
 * Chunks the bundler's runtime loads *lazily*, which the shell HTML therefore
 * never names in a `src`/`href`. They are listed inside the chunks the HTML
 * does name, so one extra pass over those bodies finds them.
 *
 * Without this the offline shell could reload into the error boundary —
 * "Something went sideways" instead of the roll call — because hydration
 * asked for a chunk nothing had cached and the network was gone. It only
 * *sometimes* happened, since the browser's own HTTP cache often still had
 * the file; the flake in e2e/manifest.spec.ts's storage-eviction test is that
 * coin toss, and on a boat it is the same coin toss with a manifest on it.
 *
 * Deliberately **one level, not transitive closure**: at the time of writing
 * that is 3 extra chunks (~340 KB on top of ~1.8 MB) and it covers the case,
 * whereas following references recursively walks toward the whole app's chunk
 * graph on a crew member's phone. And deliberately **best-effort**, unlike the
 * HTML-referenced set below: these paths come from a regex over minified
 * JavaScript, so a false positive is possible and must not be able to fail a
 * shell save that is otherwise complete.
 */
async function lazyChunkEntries(assetEntries) {
  const referenced = new Set();
  await Promise.all(
    assetEntries.map(async ([asset, assetResponse]) => {
      if (!asset.endsWith(".js")) return;
      const body = await assetResponse.clone().text();
      for (const match of body.matchAll(/static\/chunks\/[A-Za-z0-9_\-.]+\.(?:js|css)/g)) {
        referenced.add(`/_next/${match[0]}`);
      }
    }),
  );
  for (const [asset] of assetEntries) referenced.delete(asset);
  const found = await Promise.all(
    [...referenced].map(async (asset) => {
      try {
        const assetResponse = await fetch(asset);
        return assetResponse.ok ? [asset, assetResponse] : null;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((entry) => entry !== null);
}

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
  assetEntries.push(...(await lazyChunkEntries(assetEntries)));
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
  if (event.data?.type === "GET_SHELL_VERSION") {
    event.ports[0]?.postMessage({ version: SHELL_VERSION });
    return;
  }
  if (event.data?.type === "CACHE_OFFLINE_MANIFEST_SHELL") {
    // Reply on the caller's port instead of firing and forgetting: the client
    // treats a save as safe to announce as "ready" only once the shell (and
    // every asset it references) is actually confirmed cached, not merely
    // requested — an already-active worker can still fail this (storage
    // quota, a dropped fetch) and the caller needs to know.
    const port = event.ports[0];
    event.waitUntil(
      cacheOfflineShell().then(
        () => port?.postMessage({ ok: true }),
        (error) => port?.postMessage({ ok: false, error: error?.message ?? String(error) }),
      ),
    );
  }
});

/**
 * The manifest's third refresh trigger (ADR 20260804-manifest-web-push): the
 * one that reaches a phone whose page is frozen, where neither the SSE stream
 * nor the page's own interval can run.
 *
 * Two deliberate limits.
 *
 * **Every push shows a notification.** Chrome and Edge only grant a
 * subscription under `userVisibleOnly: true`, so a silent data-only push is not
 * available. The server side coalesces to at most one push per device per
 * minute, and only near departure, which is what keeps that from being noise.
 *
 * **This worker does not write the offline snapshot.** It could — the store's
 * AES-GCM key is a non-extractable CryptoKey in IndexedDB, readable from any
 * same-origin context including this one. It does not because this file is
 * static and outside the Next build (see SHELL_VERSION above), so writing
 * snapshots here would mean a second implementation of the envelope format,
 * AAD, versioning and locking, kept in lockstep by hand. Two implementations of
 * an encrypted safety-critical record is a worse failure than the gap it
 * closes. Instead: tell any live client, and let the one real implementation
 * (saveOfflineManifest) do the write. A locked phone therefore gets the
 * notification and refreshes when the captain opens it — a human in the loop at
 * departure, which is defensible, and on iOS the only thing available at all.
 *
 * Words arrive in the payload already translated. This file cannot reach the
 * message bundles, and no user-facing English may live outside src/i18n.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    // A push with no body, or a body that isn't ours, still gets a
    // notification — `userVisibleOnly` obliges us to show one, and silently
    // swallowing it is what gets a subscription revoked.
  }
  if (payload.kind && payload.kind !== "manifest-changed") return;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // A page that is merely hidden (device awake, tab backgrounded) can still
      // refresh itself through the normal path — no tap needed. A frozen or
      // evicted page simply isn't in this list, which is the case the
      // notification below covers.
      for (const client of clientList) {
        client.postMessage({ type: "MANIFEST_CHANGED", tripId: payload.tripId });
      }
      // The device doing the roll call must not buzz at itself. A visible
      // same-origin client has already refreshed on the message above, so
      // there is nothing to tell anyone — this is the "silent refresh" row of
      // the ADR's table, and without this check that row does not exist.
      // Skipping showNotification is permitted precisely because a visible
      // client makes the effect user-visible another way.
      if (clientList.some((client) => client.visibilityState === "visible")) return;
      if (!payload.title) return;
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        // Collapses on the device as well as on the server: a second push for
        // the same trip replaces the first rather than stacking.
        tag: payload.tripId ? `manifest-${payload.tripId}` : "manifest",
        // Replacing the sitting notification must still alert. With
        // `renotify: false` a stable tag silently swaps identical text, so only
        // the day's *first* change would ever buzz and every later one would be
        // mute — the server's 60-second coalescing window is already the noise
        // bound, and this would have been a second, undeclared throttle that
        // swallowed everything after it.
        renotify: true,
        data: { url: payload.url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url;
  // Same-origin, absolute-path only. `clients.openWindow` is not origin-scoped
  // the way `client.navigate` is, so an off-origin URL here would open an
  // attacker's page from a tap on a notification the user trusts. Reaching
  // that requires the VAPID private key *and* this device's keys — server plus
  // database compromise — but the guard is two lines and closes the
  // escalation. "//host" is rejected too: it looks relative and is not.
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) return;
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus the manifest if it is already open rather than stacking a second
      // copy of a page a captain may have unsent roll-call events on.
      for (const client of clientList) {
        // Compare the parsed pathname, not a substring: `endsWith` would treat
        // an unrelated URL that merely finishes with this path as a match.
        if (new URL(client.url).pathname === target && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
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

  if (event.request.mode === "navigate" && url.pathname === "/") {
    // The root path only — never a wildcard fallback for every failed
    // navigation (see ADR 20260726-shopwide-offline-manifest-priming). A
    // captain typing "dive.day" with no signal lands on whatever this
    // device already has saved instead of the browser's own offline error;
    // online, "/" is untouched and still the marketing home page.
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedShell = await caches.match(OFFLINE_SHELL);
        if (!cachedShell) return Response.error();
        return Response.redirect(new URL(OFFLINE_SHELL, self.location.origin).href, 302);
      }),
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
