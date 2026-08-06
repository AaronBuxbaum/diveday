/// <reference lib="webworker" />
import { MANIFEST_SYNC_TAG } from "@/lib/background-flush";
import {
  listOfflineManifests,
  saveOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestUpcomingResponse } from "@/lib/offline-manifests";

/**
 * The offline manifest's service worker.
 *
 * **This file is compiled** (`scripts/build-service-worker.mjs` →
 * `public/manifest-sw.js`). It used to be hand-written static JavaScript that
 * could import nothing, and that one limitation is what forced every
 * background capability to stop at "wake a page and let it do the work". It
 * now imports the real `offline-manifest-store`, so a snapshot written here is
 * written by the *same* implementation the page uses — one encrypted format,
 * one AAD, one lock — rather than a hand-kept copy of it.
 *
 * What that unlocks, and why it matters on a boat: a captain with the phone
 * pocketed and the page frozen now gets the device copy actually updated
 * (`push`, below) and pending roll-call events actually sent when signal
 * returns (`sync`, below). Neither was possible before; the worker could only
 * show a notification and hope somebody opened the app.
 *
 * Bump the trailing "-v<n>" on a deploy that changes the offline shell, and
 * bump `OFFLINE_MANIFEST_SHELL_VERSION` in src/lib/offline-manifests.ts to
 * match. The two are still compared at runtime (`getActiveOfflineShellVersion`)
 * to tell a crew member holding a worker from an older deploy — and the build
 * script now *asserts* they agree, so a mismatch fails the build instead of
 * shipping a worker that misreports its version from a boat.
 */
declare const self: ServiceWorkerGlobalScope;

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
/** A path and the response fetched for it, the pair the shell cache works in. */
type AssetEntry = [asset: string, assetResponse: Response];

async function lazyChunkEntries(assetEntries: AssetEntry[]): Promise<AssetEntry[]> {
  const referenced = new Set<string>();
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
        return assetResponse.ok ? ([asset, assetResponse] as AssetEntry) : null;
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
  const assetPaths = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="([^"#?]*\/_next\/static\/[^"?#]+)"/g)) {
    assetPaths.add(new URL(match[1], self.location.origin).pathname);
  }
  // Fetch the shell and every asset it references before writing anything.
  // This now runs automatically (not just on an explicit "Save for offline"
  // click), so a mid-fetch failure — a deploy landing between requests, a
  // flaky connection — must never partially overwrite an already-working
  // offline copy with new HTML pointing at assets that were never cached.
  const assetEntries: AssetEntry[] = await Promise.all(
    [...assetPaths].map(async (asset): Promise<AssetEntry> => {
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
/**
 * Refresh every device copy in the rolling window, here in the worker.
 *
 * This is the whole point of compiling this file. `/api/offline-manifests/upcoming`
 * already returns exactly what `saveOfflineManifest` takes — it was built for
 * the page's own auto-save (ADR 20260726-shopwide-offline-manifest-priming) —
 * and a worker's `fetch` carries the session cookie on a same-origin request,
 * so nothing new was needed on the server to do this from a frozen page.
 *
 * Failure is silent and non-fatal by design: this runs on a locked phone with
 * no one to tell. If it fails, the notification still shows and the copy stays
 * whatever it was, which is exactly the behaviour that existed before.
 */
async function refreshSavedManifests(): Promise<void> {
  try {
    const response = await fetch("/api/offline-manifests/upcoming", {
      // Explicit rather than relying on the same-origin default: this request
      // is worthless without the staff session, and a silent 401 here would
      // look identical to "nothing to save".
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;
    // `payloads`, not `manifests`. The route answers `{ shop, payloads }`;
    // `manifests` is the key *inside* each payload, and reading it here meant
    // this loop always ran zero times — a locked phone got the notification and
    // a snapshot exactly as stale as before, which is the gap this function was
    // added to close. Read through the route's own declared response type now,
    // so the next rename is a `tsc -p src/worker` failure rather than a silent
    // no-op at sea. The one caller that wants only `shop` asks
    // `/api/offline-manifests/identity` instead; this one is here for the board.
    const body = (await response.json()) as Partial<OfflineManifestUpcomingResponse>;
    for (const payload of body.payloads ?? []) {
      // Sequential, not Promise.all: these share one IndexedDB lock inside the
      // store, and a locked phone is not where to discover lock contention.
      await saveOfflineManifest(payload).catch(() => undefined);
    }
  } catch {
    // Offline, signed out, or the endpoint moved — all the same here.
  }
}

self.addEventListener("push", (event) => {
  let payload: {
    kind?: string;
    tripId?: string;
    title?: string;
    body?: string;
    url?: string;
  } = {};
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

      // No visible page, so nothing else is going to do this.
      //
      // **Send before receiving.** A push is the only moment an iOS device ever
      // runs this worker in the background: Safari has never implemented
      // Background Sync — not in a tab, not in a Home Screen web app — so the
      // `sync` handler below simply never fires there. Flushing here is what
      // gives an installed iPhone an outbound path at all, and it costs nothing
      // on the platforms that do have Background Sync (there is rarely anything
      // left pending by the time a push lands).
      //
      // Ordered first so the roll call recorded at sea leaves the device before
      // the snapshot is replaced — the events are the record of who came back
      // aboard, and getting them off one phone matters more than the roster
      // being current on it.
      await flushPendingRollCall().catch(() => undefined);

      // Then the inbound half: write the device copy. This is what makes a
      // pocketed phone actually carry the change rather than merely learn about
      // it — before this, a locked phone got a notification and a snapshot that
      // stayed exactly as stale as it was.
      await refreshSavedManifests();

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
        // `renotify` ships in Chrome and is what makes a replaced notification
        // still alert, but lib.dom does not declare it — so the object is cast
        // rather than the property dropped, which would silence every change
        // after the day's first.
      } as NotificationOptions & { renotify: boolean });
    })(),
  );
});

/**
 * Send the roll call that was recorded at sea, once signal comes back — with
 * no page open.
 *
 * This closes the *outbound* half of the pocket problem, and it is the more
 * serious half. `syncOfflineManifest` is otherwise only ever called from the
 * page (reconnect, visibility-return, the 5-minute interval), so a captain who
 * records roll call offshore, closes the tab, and drives home does not send
 * those events until somebody reopens DiveDay. A stale roster is a display
 * problem; unsent roll-call events are the record of *who came back aboard*
 * sitting on one phone.
 *
 * Background Sync exists for exactly this: the browser fires `sync` when
 * connectivity returns, page or no page. Rethrowing on failure is deliberate —
 * it tells the browser to retry the tag later rather than treating a failed
 * flush as done.
 */
// "sync" is not in TypeScript's ServiceWorkerGlobalScope event map, so the
// listener is registered through the untyped overload and the event narrowed
// here. The shape is stable and specified; only the typings lag.
self.addEventListener("sync" as keyof ServiceWorkerGlobalScopeEventMap, (event) => {
  const syncEvent = event as unknown as ExtendableEvent & { tag?: string };
  if (syncEvent.tag !== MANIFEST_SYNC_TAG) return;
  syncEvent.waitUntil(flushPendingRollCall());
});

async function flushPendingRollCall(): Promise<void> {
  // Every trip this device holds a copy for. `listOfflineManifests` is the
  // store's own reader, so the worker discovers what to flush exactly the way
  // the page would.
  const envelopes = await listOfflineManifests();
  const tripIds = envelopes
    .map((envelope) => envelope.snapshot.manifests[0]?.trip.id)
    .filter((id): id is string => Boolean(id));
  let failed = false;
  for (const tripId of tripIds) {
    // One at a time, for the same IndexedDB-lock reason as the save loop.
    try {
      await syncOfflineManifest(tripId);
    } catch {
      failed = true;
    }
  }
  // Throwing asks the browser to keep the tag and retry. Swallowing it would
  // silently abandon events that are still on the device.
  if (failed) throw new Error("manifest sync incomplete");
}

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
