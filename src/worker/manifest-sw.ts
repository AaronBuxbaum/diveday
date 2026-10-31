/// <reference lib="webworker" />
import { MANIFEST_SYNC_TAG } from "@/lib/background-flush";
import { nowMs } from "@/lib/clock";
import {
  beginOfflineTenantVerificationRound,
  listOfflineManifests,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
  syncOfflineManifest,
  wipeOfflineMedicalAlerts,
} from "@/lib/offline-manifest-store";
import {
  fetchOfflineManifestShopSlug,
  OFFLINE_FALLBACK_PARAM,
  OFFLINE_MANIFEST_SHELL_VERSION,
  type OfflineFallbackReason,
  offlineManifestMayHoldMedicalAlertWords,
  offlineManifestPayloads,
  offlineManifestShopSlug,
  offlineManifestViewerPersonId,
  pendingOfflineEventCount,
} from "@/lib/offline-manifests";
import { cacheOfflineShell as cacheShell } from "./offline-shell-cache";
import {
  beginReadyPageRequest,
  forgetReadyPage,
  isReadyScope,
  observeReadyPageClock,
  purgeLegacyReadyCopies,
  type ReadyPageRequest,
  readyPageFallback,
  readyPagePath,
  saveReadyPage,
} from "./ready-page-cache";

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
 * Bump `OFFLINE_MANIFEST_SHELL_VERSION` in src/lib/offline-manifests.ts when a
 * deploy changes this shell. The cache key and the version sent to pages both
 * derive from that one value, while encrypted manifest records keep their own
 * independent version.
 */
declare const self: ServiceWorkerGlobalScope;

/**
 * The production build this worker was generated from (`{ id, assets }`),
 * injected by `scripts/build-service-worker.mjs` from the build's route
 * manifest. `null` in dev, where chunk names are mutable and only the shell
 * document is precached.
 */
declare const __OFFLINE_SHELL_BUILD__: { id: string; assets: readonly string[] } | null | undefined;
const SHELL_BUILD = typeof __OFFLINE_SHELL_BUILD__ === "undefined" ? null : __OFFLINE_SHELL_BUILD__;

const SHELL_CACHE_PREFIX = "diveday-offline-manifest-shell-";
/** Keyed by build too: one deploy's shell and chunks live and die together, so caches never pile up. */
const CACHE_NAME = `${SHELL_CACHE_PREFIX}${OFFLINE_MANIFEST_SHELL_VERSION}${SHELL_BUILD ? `-${SHELL_BUILD.id}` : ""}`;
const SHELL_VERSION = OFFLINE_MANIFEST_SHELL_VERSION;
const OFFLINE_SHELL = "/offline-manifest";

/** Dev chunk names can be reused after an edit; only production assets promise immutability. */
function immutableAsset(response: Response): boolean {
  const directives = (response.headers.get("cache-control") ?? "")
    .toLowerCase()
    .split(",")
    .map((directive) => directive.trim());
  return directives.includes("immutable") && !directives.includes("no-store");
}
// Matches the live, authenticated roll-call page this shell backs up —
// never any other /shop route — so a captain who reloads mid-departure with
// no signal lands on their saved device copy instead of the browser's own
// offline error, without this worker reaching beyond the manifest.
const LIVE_MANIFEST_PATTERN = /^\/shop\/[^/]+\/trips\/([^/]+)\/manifest(?:\/.*)?$/;
// The counter, and only the counter — the second authenticated page this shell
// backs up (ADR 20260907-the-counter-survives-offline). The counter is a
// departure's Divers tab, whose roster carries the desk's taps once arrivals
// open (owner, 2026-10-05), so a staffer who reloads it with no signal lands on
// the saved copy of that departure rather than the browser's offline error;
// the departure is the path segment, so the redirect carries it across as
// `?trip=`. The tab itself and nothing under it: the walk-in flow beneath this
// path seats a diver, which needs a server, and `trips/new` is not a departure
// (hence the id's own shape rather than any segment).
const COUNTER_PATTERN = /^\/shop\/[^/]+\/trips\/([0-9a-f]{8}-[0-9a-f-]{27})\/?$/i;

/**
 * How long a navigation waits for the network before the worker shows the
 * device's saved copy instead. Dock Wi-Fi can show full bars and carry
 * nothing; on that network a request neither answers nor fails, it waits,
 * and a fallback that waits for `fetch` to fail never comes. Four seconds is
 * past a normal page load on a weak link and well short of a captain giving
 * up on the phone.
 */
const NAVIGATION_TIMEOUT_MS = 4_000;

/**
 * How long a push waits on the roll-call flush and the board refresh before
 * it shows the captain's notification anyway (issue #2981). The same four
 * seconds as a navigation: a push event a browser lets run for well under a
 * minute, and an alert that comes late is worth more than one that never does.
 */
const PUSH_REFRESH_TIMEOUT_MS = 4_000;

/**
 * Network-first with a deadline: the live page whenever the network answers,
 * the device's saved copy when it fails, and the saved copy too once
 * `NAVIGATION_TIMEOUT_MS` passes without an answer. `saved` is told which of
 * the two it was, so the copy can say why it is on screen.
 *
 * By default, with nothing saved to show, it keeps waiting for the network
 * rather than trading a slow page for an error page. The readiness route opts
 * into a browser error at the deadline because it has no safe substitute.
 * `live` receives the abort signal, so a request given up on is stopped, and
 * work chained inside `live` never runs for a response nobody shows.
 */
async function networkFirst(
  live: (signal: AbortSignal) => Promise<Response>,
  saved: (why: OfflineFallbackReason) => Promise<Response | null | undefined>,
  options: { noSavedCopyOnSlow: "wait" | "error" } = { noSavedCopyOnSlow: "wait" },
): Promise<Response> {
  const controller = new AbortController();
  const network = live(controller.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS);
  });
  try {
    // Raced as well as aborted: a fetch that ignores its signal still cannot
    // hold the captain past the deadline.
    const answered = await Promise.race([network, deadline]);
    if (answered) return answered;
  } catch {
    return (await saved("failed")) ?? Response.error();
  } finally {
    clearTimeout(timer);
  }
  const copy = await saved("slow");
  if (!copy) {
    if (options.noSavedCopyOnSlow === "error") {
      // The readiness page has no safe substitute when its saved copy is
      // absent. Give the network the same four-second grace period, then
      // finish this navigation instead of leaving it pending indefinitely.
      controller.abort();
      network.catch(() => undefined);
      return Response.error();
    }
    // Staff pages may still be loading over a slow connection; preserve that
    // behavior when the device has no offline shell to show.
    return network.catch(() => Response.error());
  }
  controller.abort();
  network.catch(() => undefined);
  return copy;
}

/**
 * The saved offline shell, opened at `search`, or null when this device has
 * none. The redirect says why it was made (`OFFLINE_FALLBACK_PARAM`): the
 * shell words a copy it was sent to differently from one a captain opened, and
 * this worker serves the shell for that redirect from its cache at once.
 */
async function offlineShellRedirect(
  why: OfflineFallbackReason,
  search = new URLSearchParams(),
): Promise<Response | null> {
  const cachedShell = await caches.match(OFFLINE_SHELL);
  if (!cachedShell) return null;
  const redirectTarget = new URL(OFFLINE_SHELL, self.location.origin);
  search.set(OFFLINE_FALLBACK_PARAM, why);
  redirectTarget.search = search.toString();
  return Response.redirect(redirectTarget.href, 302);
}

function cacheOfflineShell(): Promise<void> {
  return cacheShell({
    fetch: (input, init) => fetch(input, init),
    caches,
    cacheName: CACHE_NAME,
    shellPath: OFFLINE_SHELL,
    build: SHELL_BUILD,
  });
}

/**
 * Whether this copy of the worker is the diver's, registered from `/ready/`
 * with that scope (`ready-page-cache.ts`), rather than the staff worker at `/`.
 * The same script, two registrations: the diver's does nothing but keep their
 * trip-prep page, and never fetches the staff shell.
 */
function inReadyScope(): boolean {
  return isReadyScope(self.registration?.scope);
}

let readyRequestGeneration = 0;
function keepReadyPage(
  path: string,
  response: Response,
  request: ReadyPageRequest,
  generation: number,
) {
  return saveReadyPage(
    caches,
    path,
    response,
    nowMs(),
    request,
    () => generation === readyRequestGeneration,
  );
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  if (inReadyScope()) return;
  event.waitUntil(cacheOfflineShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      purgeLegacyReadyCopies(caches),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== CACHE_NAME)
              .map((key) => caches.delete(key)),
          ),
        ),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "KEEP_READY_PAGE") {
    // The first visit renders before this worker controls the page, so the
    // page asks once. Only in the diver's own registration, only for the page
    // that asked (its own path), and only a readiness link.
    const port = event.ports[0];
    const source = event.source as Client | null;
    const sourceUrl = source?.url ? new URL(source.url) : null;
    const path = sourceUrl
      ? readyPagePath(new URL(sourceUrl.pathname, self.location.origin), self.location.origin)
      : null;
    // A `?cancelled=` landing forgets the copy on its way in (below); its own
    // keep request must not put it back.
    if (!inReadyScope() || !path || sourceUrl?.searchParams.has("cancelled")) {
      port?.postMessage({ ok: false });
      return;
    }
    const generation = ++readyRequestGeneration;
    event.waitUntil(
      beginReadyPageRequest(caches, path)
        .then((request) =>
          fetch(path, { credentials: "same-origin", cache: "no-store" }).then((response) =>
            keepReadyPage(path, response, request, generation),
          ),
        )
        .then(
          (ok) => port?.postMessage({ ok }),
          () => port?.postMessage({ ok: false }),
        ),
    );
    return;
  }
  if (event.data?.type === "FORGET_READY_PAGE") {
    // **The cancelled landing asks** (issue #2979, security review finding
    // 1). A self-cancel is a server action whose redirect a hydrated page
    // follows without a navigation, so the fetch listener below never sees
    // the `?cancelled=` load; the cancelled card asks here instead. Only the
    // page that asked, by its own path, so one booking cannot drop another's.
    const port = event.ports[0];
    const source = event.source as Client | null;
    const sourceUrl = source?.url ? new URL(source.url) : null;
    const path = sourceUrl
      ? readyPagePath(new URL(sourceUrl.pathname, self.location.origin), self.location.origin)
      : null;
    if (!inReadyScope() || !path) {
      port?.postMessage({ ok: false });
      return;
    }
    event.waitUntil(forgetReadyPage(caches, path, nowMs()).then((ok) => port?.postMessage({ ok })));
    return;
  }
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
    // The diver's `/ready/` registration keeps their page and nothing else, as
    // its install already does (issue #2693): no staff shell from there.
    if (inReadyScope()) {
      port?.postMessage({ ok: false });
      return;
    }
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
 * **The snapshot is written here, but never by a second implementation.** This
 * file used to be hand-written static JavaScript outside the Next build, so
 * writing an encrypted record from it would have meant a duplicate of the
 * envelope format, AAD, versioning and locking kept in lockstep by hand — a
 * worse failure than the gap it closed, which is why the worker could only wake
 * a page and hope. It is compiled now (see the file docblock), so it calls the
 * one real implementation, `saveOfflineManifest`, and inherits every rule that
 * comes with it — including the cross-shop purge that must run first on a
 * shared boat tablet (`refreshSavedManifests` below). Live clients are still
 * told either way, so a visible page refreshes itself without a tap.
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
    const tenantRound = await beginOfflineTenantVerificationRound();
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
    // added to close. Both keys are read through parsers that destructure the
    // route's own declared response type, so the next rename is a
    // `tsc --noEmit -p src/worker` failure rather than a silent no-op at sea,
    // and a body of the wrong shape is `null`/`[]` rather than a cast that
    // believes whatever it is told. The one caller that wants only `shop` asks
    // `/api/offline-manifests/identity` instead; this one is here for the board.
    const body: unknown = await response.json();
    // **Purge before saving, exactly as `OfflineManifestAutoSave` does.** This
    // response already carries the server-verified tenant at zero extra cost,
    // and without acting on it a worker-only refresh — a push landing with no
    // page open, which is the whole reason this function exists — writes shop
    // B's entire 48-hour board in beside shop A's resident records on a shared
    // boat tablet, and nothing on the device ever removes them (security
    // review, 2026-08-06). No tenant, no round: saving without a purge is the
    // cross-tenant failure this sequence exists to prevent.
    const shopSlug = offlineManifestShopSlug(body);
    if (!shopSlug) return;
    // Uncaught on purpose: a purge that throws falls to this function's own
    // catch below, which abandons the round before anything is written — the
    // same fail-closed order the page-side auto-save keeps, rather than
    // leaving both shops' rosters readable side by side.
    await purgeOfflineManifestsExceptShop(shopSlug, tenantRound);
    // Medical alert words another person saved on this device go before
    // anything is saved for this one (H-153 amendment). A body that names
    // nobody wipes them all: fail closed.
    await wipeOfflineMedicalAlerts(offlineManifestViewerPersonId(body) ?? undefined, tenantRound);
    for (const payload of offlineManifestPayloads(body)) {
      // Sequential, not Promise.all: these share one IndexedDB lock inside the
      // store, and a locked phone is not where to discover lock contention.
      // Words this viewer may no longer hold go (security review 2, L3).
      await saveOfflineManifest(payload, {
        keepMedicalAlertWords: offlineManifestMayHoldMedicalAlertWords(
          body,
          payload.manifests[0]?.trip.id,
        ),
        tenantRound,
      }).catch(() => undefined);
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
      //
      // Then the inbound half: write the device copy. This is what makes a
      // pocketed phone actually carry the change rather than merely learn about
      // it — before this, a locked phone got a notification and a snapshot that
      // stayed exactly as stale as it was.
      //
      // **Both halves race a deadline, the notification never waits past it**
      // (issue #2981). On a dead link a fetch neither answers nor fails, and a
      // notification queued behind it never showed: the captain got no alert
      // at all. The work is not dropped at the deadline; it runs on behind
      // the notification, and this event waits for it below.
      const work = flushPendingRollCall()
        .catch(() => undefined)
        .then(refreshSavedManifests);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        work,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, PUSH_REFRESH_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);

      if (payload.title) await showManifestNotification(payload.title, payload);
      await work;
    })(),
  );
});

/** The captain's alert for a changed manifest; one per trip on the device. */
function showManifestNotification(
  title: string,
  payload: { tripId?: string; body?: string; url?: string },
): Promise<void> {
  return self.registration.showNotification(title, {
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
}

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
  // Only records with something to send, which is also what lets a device with
  // nothing queued skip the tenant lookup below entirely — a push on a quiet
  // phone must not cost a round trip. `syncOfflineManifest` would return early
  // on these anyway; the filter is here so "is there anything to flush?" is
  // answered before "who are we?", not after.
  // Through the shared count rather than a list of arrays spelled out here:
  // the counter's queue joined the envelope on 2026-09-07, and a flush that
  // could not see one of the three would leave that evidence sitting on the
  // device until the purge that cannot see it either deletes the record.
  const pending = envelopes.filter((envelope) => pendingOfflineEventCount(envelope) > 0);
  if (pending.length === 0) return;

  // **Whose events are these?** Resolved once, from the server, before
  // anything is submitted — the same rule and the same reason
  // `OfflineManifestView.reconcileList` applies on the page side, and it
  // belongs here at least as much, because here there is nobody to tell when
  // it goes wrong (security review, 2026-08-06).
  //
  // A shop can still change between this identity read and the sync request.
  // Pass the verified slug as a comparison fence; the route checks it against
  // its authenticated session and refuses a changed tenant as one failed batch,
  // leaving every event pending for the original shop to retry.
  const tenantRound = await beginOfflineTenantVerificationRound();
  const shopSlug = await fetchOfflineManifestShopSlug();
  if (!shopSlug) {
    // Offline, signed out, a 404, a body of the wrong shape: reconcile
    // *nothing* rather than guess. Thrown rather than returned so the browser
    // keeps the sync tag and tries again later — the events are still on the
    // device and this flush did not happen, which is exactly what the tag is
    // for. The push path swallows it (`.catch`), so a locked phone is
    // unaffected either way.
    throw new Error("manifest sync tenant unknown");
  }

  let failed = false;
  for (const envelope of pending) {
    // A record belonging to some other shop is left exactly where it is:
    // untouched, still pending, still the only copy of that boarding record,
    // waiting for its own shop's session to come back to this device.
    if (envelope.snapshot.shop.slug !== shopSlug) continue;
    const tripId = envelope.snapshot.manifests[0]?.trip.id;
    if (!tripId) continue;
    // One at a time, for the same IndexedDB-lock reason as the save loop.
    try {
      await syncOfflineManifest(tripId, shopSlug, tenantRound);
    } catch {
      failed = true;
    }
  }
  // Throwing asks the browser to keep the tag and retry. Swallowing it would
  // silently abandon events that are still on the device. A skipped
  // foreign-shop record is not a failure — nothing about it will ever succeed
  // under this session, so retrying the tag for it would spin forever.
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

  const readyPath = inReadyScope() ? readyPagePath(url, self.location.origin) : null;
  const observeClock = Boolean(readyPath) && !url.searchParams.has("cancelled");
  const clockObserved = observeClock ? observeReadyPageClock(caches, nowMs()) : Promise.resolve();
  if (observeClock && event.request.mode !== "navigate") event.waitUntil(clockObserved);

  if (inReadyScope() && event.request.mode === "navigate") {
    const path = readyPath;
    if (!path) return;
    if (url.searchParams.has("cancelled")) {
      // The diver just cancelled this seat (`cancelMyBookingAction`): the copy
      // goes with it (security review of layer 8, D2), **before** the network
      // is asked, and this load never falls back to it (issue #2979). A slow
      // answer is waited for and a failed one is the browser's own offline
      // error: the pre-cancel page, links and all, is never what a cancel
      // lands on.
      const forgotten = forgetReadyPage(caches, path, nowMs());
      event.waitUntil(forgotten);
      event.respondWith(
        forgotten
          // Cancellation is already authoritative on the server. Keep showing
          // its confirmation even if storage failed; the page's forget message
          // reports that the saved copy may remain and gives a retry step.
          .then(() => fetch(event.request))
          .catch(() => Response.error()),
      );
      return;
    }
    event.respondWith(
      // Network-first: online, the diver always gets the live page. Only a
      // clean load is kept (a `?saved=` notice is a moment, not the page).
      networkFirst(
        (signal) => {
          const generation = ++readyRequestGeneration;
          return beginReadyPageRequest(caches, path).then((request) =>
            fetch(event.request, { signal }).then((response) => {
              if (!signal.aborted && url.search === "") {
                event.waitUntil(
                  keepReadyPage(path, response.clone(), request, generation).catch(() => false),
                );
              }
              return response;
            }),
          );
        },
        () => clockObserved.then(() => readyPageFallback(caches, path, nowMs())),
        { noSavedCopyOnSlow: "error" },
      ),
    );
    return;
  }

  if (event.request.mode === "navigate" && url.pathname === OFFLINE_SHELL) {
    // **One deadline across the hop.** This worker's own redirect from the
    // live manifest, the counter or `/` has already given the network its
    // four seconds; spending four more here put the captain's first paint at
    // eight on a dead link. So the shell it sent them to comes from the cache.
    if (url.searchParams.has(OFFLINE_FALLBACK_PARAM)) {
      event.respondWith(
        caches
          .match(OFFLINE_SHELL)
          .then((cachedShell) => cachedShell ?? fetch(event.request))
          .catch(() => Response.error()),
      );
      return;
    }
    event.respondWith(
      networkFirst(
        (signal) =>
          fetch(event.request, { signal }).then(async (response) => {
            if (response.ok) (await caches.open(CACHE_NAME)).put(OFFLINE_SHELL, response.clone());
            return response;
          }),
        () => caches.match(OFFLINE_SHELL),
      ),
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
      networkFirst(
        (signal) => fetch(event.request, { signal }),
        (why) => offlineShellRedirect(why),
      ),
    );
    return;
  }

  const counterMatch = event.request.mode === "navigate" && url.pathname.match(COUNTER_PATTERN);
  if (counterMatch) {
    const tripId = counterMatch[1];
    event.respondWith(
      // Network-first, exactly like the live manifest below: the counter is
      // never served from cache, and this only ever substitutes the device's
      // own offline copy once the network fails or stops answering.
      networkFirst(
        (signal) => fetch(event.request, { signal }),
        (why) => offlineShellRedirect(why, new URLSearchParams({ trip: tripId })),
      ),
    );
    return;
  }

  if (event.request.mode === "navigate") {
    const liveManifestMatch = url.pathname.match(LIVE_MANIFEST_PATTERN);
    if (liveManifestMatch) {
      const tripId = liveManifestMatch[1];
      event.respondWith(
        // Network-first: the live manifest is never served from cache — this
        // only ever substitutes the device's own offline copy, once the
        // network fails or stops answering.
        networkFirst(
          (signal) => fetch(event.request, { signal }),
          (why) => {
            const search = new URLSearchParams({ trip: tripId });
            // Carries the checkpoint a captain was on (e.g. "after_dive_1") so a
            // reload mid roll call doesn't drop them back to "Before departure".
            const checkpoint = url.searchParams.get("checkpoint");
            if (checkpoint) search.set("checkpoint", checkpoint);
            return offlineShellRedirect(why, search);
          },
        ),
      );
      return;
    }
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then(async (cached) => {
        if (cached && immutableAsset(cached)) return cached;
        // Older workers cached mutable development chunks. Ignore and remove
        // those copies so a dependency update cannot mix two runtimes.
        if (cached) {
          await caches
            .open(CACHE_NAME)
            .then((cache) => cache.delete(event.request))
            .catch(() => {});
        }
        const response = await fetch(event.request);
        if (response.ok && immutableAsset(response)) {
          // Cache storage is best effort: quota must not break an online page.
          await caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, response.clone()))
            .catch(() => {});
        }
        return response;
      }),
    );
  }
});
