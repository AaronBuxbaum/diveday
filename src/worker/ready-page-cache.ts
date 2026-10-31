/**
 * **The diver's trip-prep copy, kept on their own phone** — what the last
 * `/ready/<token>` this browser opened could say, served only when the network
 * fails.
 *
 * At a marina with no signal the diver had the printed pass or nothing. This
 * keeps exactly one copy of a purpose-built snapshot (issue #3225), under
 * rules chosen so the copy can never be a way in that the link itself was not:
 *
 * - **A snapshot, not the page.** The worker never stores the page it was
 *   handed. It asks the server for `/ready/<token>/offline` (the route
 *   `src/app/ready/[token]/offline/route.ts`), which reads a short list of
 *   fields off the verified booking and answers three finished documents.
 *   They hold no token, no link and no form, so there is nothing to redact
 *   here: no HTML is parsed or rewritten, and the worker only chooses which
 *   document to serve. The served document carries a Content-Security-Policy
 *   that allows no script and no network.
 * - **Only from a registration scoped to `/ready/`** (the caller checks): the
 *   staff worker at `/` never stores one, so a shared shop tablet that opens a
 *   diver's link through the staff app keeps nothing.
 * - **Only the page itself, same origin, by its exact path**: the token in the
 *   path *is* the capability, so the cache answers only someone who already
 *   holds it. No query string, nothing under it (`/forms`), no redirect.
 * - **One copy, the last one saved, under a key that names no token**
 *   (security review of layer 8, D1): Cache Storage is origin-wide and any
 *   same-origin script can list its keys, so the copy lives at
 *   {@link READY_COPY_KEY} and carries only a SHA-256 of its path. A request
 *   is answered only when its own path hashes to the same value, so a phone
 *   that opened two bookings holds only the newer.
 * - **The diver can remove it**: "Remove saved copy" on the page, and every
 *   staff sign-out, run `forgetReadyPageCopy` (`src/lib/ready-offline.ts`).
 * - **Read-only, network-first**: a cached copy is served only when `fetch`
 *   fails. It has no control that posts anything; nothing is queued.
 * - **Expiry follows a trusted server time**: the snapshot carries the server's
 *   clock when it was built. That instant calibrates the device clock offset
 *   used to estimate expiry. A fixed offset works offline; an unobserved
 *   forward clock jump after saving is indistinguishable from elapsed time and
 *   can expire a copy early. A backward jump, or no clock history to compare
 *   with, serves a warning document instead. A copy remains a saved snapshot,
 *   never live readiness.
 * - **Bounded by the trip, not only by the clock** (D2): the snapshot names the
 *   instant its copy expires (a day after the boat is due back), capped at
 *   {@link READY_COPY_MAX_AGE_MS}. A server that refuses one (a cancelled
 *   booking, a departure called off, a dead link) clears the copy instead of
 *   replacing it, and a cancelled landing forgets it outright: by navigation,
 *   or by the cancelled card asking the worker when the cancel's redirect was
 *   not one (#2979). A save whose request began before that forget stores
 *   nothing.
 *
 * **A residual we accept** (issue #2478, decided 2026-10-16): a staff cancel
 * or a blow-out (`src/db/blowouts.ts`) reaches the copy only when the diver
 * next opens the link online. A phone that never does keeps showing the copy
 * until its date. A push could drop the copy, but divers have no push
 * subscription (web push serves staff manifests, ADR 20260804-manifest-web-push)
 * and a diver offline at the marina is the one phone a push cannot reach, so
 * the date above is the bound. The e2e spec `e2e/ready-offline.spec.ts` pins
 * the two ends: the copy shows offline, and a `?cancelled=` landing clears it.
 */

import {
  parseReadySnapshot,
  READY_CACHE_NAME,
  READY_FORGOTTEN_CACHE_NAME,
  type ReadySnapshot,
  readySnapshotPath,
} from "@/lib/ready-offline";

/**
 * A readiness link and nothing else: `/ready/` and one bearer token
 * (`createBearerToken`, 32 random bytes as base64url, 43 characters).
 */
const READY_PAGE_PATTERN = /^\/ready\/[A-Za-z0-9_-]{43}$/;

/** Two weeks: the ceiling on any copy, whatever day the page names. */
export const READY_COPY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** The one key the copy is filed under: a fixed path that is never a readiness link. */
export const READY_COPY_KEY = "/ready/kept-copy";

const PATH_HASH_HEADER = "x-diveday-path-sha256";
const COPY_FORGOTTEN_VERSION_HEADER = "x-diveday-copy-forgotten-version";
const COPY_REQUEST_ID_HEADER = "x-diveday-copy-request-id";
const REQUEST_ID_HEADER = "x-diveday-ready-request-id";
const REQUEST_PATH_HASH_HEADER = "x-diveday-ready-request-path-hash";
const REQUEST_FORGOTTEN_VERSION_HEADER = "x-diveday-ready-request-forgotten-version";
const REQUEST_CANCELLED_PATH_HASH_HEADER = "x-diveday-ready-cancelled-path-hash";
const REQUEST_CANCELLED_VERSION_HEADER = "x-diveday-ready-cancelled-version";
/** One durable slot orders requests and forgets; this cache keeps only one page. */
const LATEST_REQUEST_KEY = "/ready/latest-request";
const KEEP_UNTIL_HEADER = "x-diveday-keep-until";
const DEVICE_SAVED_AT_HEADER = "x-diveday-device-saved-at";
const CLOCK_WATERMARK_HEADER = "x-diveday-clock-watermark";
const READY_CLOCK_CACHE_NAME = "diveday-ready-clock-v1";
const READY_CLOCK_KEY = "/ready/clock-observation";
const READY_CLOCK_STATE_HEADER = "x-diveday-ready-copy-time-state";

function numericHeader(response: Response, name: string): number | null {
  const value = Number(response.headers.get(name));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

type ClockWatermark = { kind: "missing" | "corrupt" } | { kind: "valid"; at: number };

let readyClockOrder: Promise<unknown> = Promise.resolve();

function serializeClockObservation<T>(operation: () => Promise<T>): Promise<T> {
  const next = readyClockOrder.then(operation, operation);
  readyClockOrder = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readClockWatermark(storage: CacheStorage): Promise<ClockWatermark> {
  try {
    const cache = await storage.open(READY_CLOCK_CACHE_NAME);
    const marker = await cache.match(READY_CLOCK_KEY);
    if (!marker) return { kind: "missing" };
    const at = numericHeader(marker, CLOCK_WATERMARK_HEADER);
    return at === null ? { kind: "corrupt" } : { kind: "valid", at };
  } catch {
    return { kind: "corrupt" };
  }
}

/** Persist the highest readiness-worker wall-clock reading across restarts. */
export async function observeReadyPageClock(storage: CacheStorage, now: number): Promise<void> {
  if (!Number.isSafeInteger(now) || now <= 0) return;
  await serializeClockObservation(async () => {
    try {
      const cache = await storage.open(READY_CLOCK_CACHE_NAME);
      const marker = await cache.match(READY_CLOCK_KEY);
      if (marker) {
        const previous = numericHeader(marker, CLOCK_WATERMARK_HEADER);
        // An unreadable marker may conceal a higher observation; never lower it.
        if (previous === null || now <= previous) return;
      }
      await cache.put(
        READY_CLOCK_KEY,
        new Response(null, { headers: { [CLOCK_WATERMARK_HEADER]: String(now) } }),
      );
    } catch {
      // The fallback will keep the copy visibly unverified if storage is unavailable.
    }
  });
}

/**
 * The document the phone is shown. The policy allows inline style and nothing
 * else: no script, no request, no frame, no form.
 */
function documentHeaders(state: "known" | "unverified" | "rollback"): Headers {
  return new Headers({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    [READY_CLOCK_STATE_HEADER]: state,
  });
}

async function pathHash(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Every entry in the copy's cache, the one copy included unless it is `keep`. */
async function clearCopies(cache: Cache, keep?: string): Promise<void> {
  for (const request of await cache.keys()) {
    if (keep && new URL(request.url).pathname === keep) continue;
    await cache.delete(request);
  }
}

/** The cache key for a request this module may handle, or null for every other. */
export function readyPagePath(url: URL, origin: string): string | null {
  if (url.origin !== origin) return null;
  return READY_PAGE_PATTERN.test(url.pathname) ? url.pathname : null;
}

/** Whether this registration is the diver's `/ready/` one rather than the staff worker. */
export function isReadyScope(scope: string | undefined): boolean {
  if (!scope) return false;
  try {
    return new URL(scope).pathname === "/ready/";
  } catch {
    return false;
  }
}

function storable(response: Response): boolean {
  if (!response.ok || response.redirected) return false;
  // "basic" is a same-origin response; anything opaque or CORS never lands here.
  if (response.type !== "basic" && response.type !== "default") return false;
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

export type ReadyPageRequest = {
  pathHash: string;
  forgottenVersion: string;
  requestId: string;
  /** Network requests remain useful when storage is unavailable; they just cannot publish. */
  durable: boolean;
};

// One request ID is enough because the durable marker has one latest-request
// slot. This closes same-worker races when a forget marker write fails.
let locallyInvalidatedRequestId: string | null = null;
let localLatestRequest: { path: string; pathHash: string; requestId: string } | null = null;

// Order request starts and forget markers separately from cache publication,
// so a new fetch can start while an older response is being written.
let readyOrder: Promise<unknown> = Promise.resolve();
function serializeReadyOrder<T>(operation: () => Promise<T>): Promise<T> {
  const next = readyOrder.then(operation, operation);
  readyOrder = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
let readyPublication: Promise<unknown> = Promise.resolve();
function serializeReadyPublication<T>(operation: () => Promise<T>): Promise<T> {
  const next = readyPublication.then(operation, operation);
  readyPublication = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function forgottenVersion(storage: CacheStorage): Promise<string> {
  const markers = await storage.open(READY_FORGOTTEN_CACHE_NAME);
  const latest = await markers.match(LATEST_REQUEST_KEY);
  return latest?.headers.get(REQUEST_FORGOTTEN_VERSION_HEADER) ?? "";
}

async function isCopyInvalidated(
  storage: CacheStorage,
  hash: string,
  cached: Response,
): Promise<boolean> {
  const markers = await storage.open(READY_FORGOTTEN_CACHE_NAME);
  const latest = await markers.match(LATEST_REQUEST_KEY);
  if (latest?.headers.get(REQUEST_CANCELLED_PATH_HASH_HEADER) !== hash) return false;
  return (
    cached.headers.get(COPY_FORGOTTEN_VERSION_HEADER) !==
    latest.headers.get(REQUEST_CANCELLED_VERSION_HEADER)
  );
}

export function beginReadyPageRequest(
  storage: CacheStorage,
  path: string,
): Promise<ReadyPageRequest> {
  return serializeReadyOrder(async () => {
    const hash = await pathHash(path);
    const request: ReadyPageRequest = {
      pathHash: hash,
      forgottenVersion: "",
      requestId: crypto.randomUUID(),
      durable: false,
    };
    try {
      const markers = await storage.open(READY_FORGOTTEN_CACHE_NAME);
      const marker = await markers.match(LATEST_REQUEST_KEY);
      const cancelledPathHash = marker?.headers.get(REQUEST_CANCELLED_PATH_HASH_HEADER) ?? "";
      const cancelledVersion = marker?.headers.get(REQUEST_CANCELLED_VERSION_HEADER) ?? "";
      request.forgottenVersion =
        cancelledPathHash === hash
          ? cancelledVersion
          : (marker?.headers.get(REQUEST_FORGOTTEN_VERSION_HEADER) ?? "");
      await markers.put(
        LATEST_REQUEST_KEY,
        new Response(null, {
          headers: {
            [REQUEST_ID_HEADER]: request.requestId,
            [REQUEST_PATH_HASH_HEADER]: request.pathHash,
            [REQUEST_FORGOTTEN_VERSION_HEADER]: request.forgottenVersion,
            [REQUEST_CANCELLED_PATH_HASH_HEADER]: cancelledPathHash,
            [REQUEST_CANCELLED_VERSION_HEADER]: cancelledVersion,
          },
        }),
      );
      locallyInvalidatedRequestId = null;
      localLatestRequest = { path, pathHash: hash, requestId: request.requestId };
      request.durable = true;
    } catch {
      // Storage failure must not block the live page. The response carries an
      // unpublishable request so it cannot overwrite or fall back to stale data.
      request.durable = false;
    }
    return request;
  });
}

async function forgottenVersionIsCurrent(
  storage: CacheStorage,
  hash: string,
  request: ReadyPageRequest,
): Promise<boolean> {
  if (request.pathHash !== hash) return false;
  return (
    request.requestId !== locallyInvalidatedRequestId &&
    (await forgottenVersion(storage)) === request.forgottenVersion
  );
}

async function requestIsCurrent(
  storage: CacheStorage,
  hash: string,
  request: ReadyPageRequest,
): Promise<boolean> {
  if (!(await forgottenVersionIsCurrent(storage, hash, request))) return false;
  const markers = await storage.open(READY_FORGOTTEN_CACHE_NAME);
  const latest = await markers.match(LATEST_REQUEST_KEY);
  if (!latest) return false;
  return (
    latest.headers.get(REQUEST_ID_HEADER) === request.requestId &&
    latest.headers.get(REQUEST_PATH_HASH_HEADER) === request.pathHash &&
    latest.headers.get(REQUEST_FORGOTTEN_VERSION_HEADER) === request.forgottenVersion
  );
}

/** A snapshot that has not come in this long is not coming; the save gives up. */
const SNAPSHOT_TIMEOUT_MS = 10_000;

/**
 * The server's snapshot for `path`: the snapshot, `"gone"` when the server
 * says there is nothing to keep (a dead link, a cancelled seat, a departure
 * called off), or null when the answer could not be read, which changes
 * nothing. Same origin, no redirect, never from the HTTP cache.
 */
async function fetchSnapshot(path: string): Promise<ReadySnapshot | "gone" | null> {
  try {
    const reply = await fetch(readySnapshotPath(path), {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
    });
    if (reply.status === 404) return "gone";
    if (!reply.ok || reply.redirected) return null;
    // Same origin only: nothing opaque or cross-origin is a snapshot.
    if (reply.type !== "basic" && reply.type !== "default") return null;
    if (!(reply.headers.get("content-type") ?? "").includes("application/json")) return null;
    return parseReadySnapshot(await reply.json());
  } catch {
    return null;
  }
}

/**
 * Keep the server's snapshot for `path` as the one copy, replacing whatever
 * was kept. `response` is the live page this save was triggered by: it only
 * has to be a real page of ours (`storable`); none of it is stored. Returns
 * whether a copy was kept; a server that refuses a snapshot, or one already
 * past its date, clears the copy.
 *
 * `request` records whether ordering was durably captured before the fetch.
 * A nondurable request may still process terminal truth, but cannot publish a
 * saved copy. The sixth parameter is the old stylesheet hook, unused now that
 * the snapshot carries its own style.
 */
export async function saveReadyPage(
  storage: CacheStorage,
  path: string,
  response: Response,
  now: number,
  request?: ReadyPageRequest,
  _prepareAssets?: (html: string) => Promise<void>,
  mayPublish: () => boolean = () => true,
): Promise<boolean> {
  if (!storable(response)) return false;
  const hash = await pathHash(path);
  const order = request ?? (await beginReadyPageRequest(storage, path));
  if (order.pathHash !== hash) return false;
  const snapshot = await fetchSnapshot(path);
  if (snapshot === null) return false;
  // Process terminal truth even without a durable request marker. Order the
  // path check and epoch write together with request starts, preventing a
  // different token from slipping between the check and global marker.
  if (snapshot === "gone" || snapshot.keepUntil <= snapshot.generatedAt) {
    await forgetTerminalReadyPath(storage, path, hash);
    return false;
  }
  if (!order.durable || !Number.isSafeInteger(now)) return false;
  const cache = await storage.open(READY_CACHE_NAME);
  const headers = new Headers({
    "content-type": "application/json",
    [KEEP_UNTIL_HEADER]: String(
      Math.min(snapshot.keepUntil, snapshot.generatedAt + READY_COPY_MAX_AGE_MS),
    ),
    [DEVICE_SAVED_AT_HEADER]: String(now),
    [PATH_HASH_HEADER]: hash,
    [COPY_FORGOTTEN_VERSION_HEADER]: order.forgottenVersion,
    [COPY_REQUEST_ID_HEADER]: order.requestId,
  });
  await observeReadyPageClock(storage, now);
  if (!(await requestIsCurrent(storage, hash, order))) return false;
  const copy = new Response(JSON.stringify(snapshot), { headers });
  return serializeReadyPublication(async () => {
    if (!(await requestIsCurrent(storage, hash, order))) return false;
    if (!mayPublish()) return false;
    await cache.put(READY_COPY_KEY, copy);
    // A forget or newer request can land between the pre-write check and
    // Cache.put. Recheck after the write and remove only this request's copy.
    if (!(await forgottenVersionIsCurrent(storage, hash, order))) {
      const kept = await cache.match(READY_COPY_KEY);
      if (
        kept?.headers.get(PATH_HASH_HEADER) === hash &&
        kept.headers.get(COPY_REQUEST_ID_HEADER) === order.requestId
      ) {
        await cache.delete(READY_COPY_KEY);
      }
      return false;
    }
    await clearCopies(cache, READY_COPY_KEY);
    return mayPublish();
  });
}

/** The kept copy for `path`, if there is one and it is still in date. */
export async function readyPageFallback(
  storage: CacheStorage,
  path: string,
  now: number,
): Promise<Response | undefined> {
  const cache = await storage.open(READY_CACHE_NAME);
  const cached = await cache.match(READY_COPY_KEY);
  if (!cached) return undefined;
  const hash = await pathHash(path);
  if (cached.headers.get(PATH_HASH_HEADER) !== hash) return undefined;
  // Whether this copy is still the diver's to see. A cancelled path's copy is
  // deleted; one whose cancellation state cannot be read is only withheld.
  const stillValid = async (): Promise<boolean> => {
    try {
      if (!(await isCopyInvalidated(storage, hash, cached))) return true;
      await cache.delete(READY_COPY_KEY).catch(() => false);
    } catch {
      // Do not serve a possibly cancelled copy offline.
    }
    return false;
  };
  if (!(await stillValid())) return undefined;
  const snapshot = parseReadySnapshot(await cached.json().catch(() => null));
  const keepUntil = Number(cached.headers.get(KEEP_UNTIL_HEADER));
  const deviceSavedAt = numericHeader(cached, DEVICE_SAVED_AT_HEADER);
  // A copy this worker did not write, or one that lost a field, is not served.
  if (!snapshot || deviceSavedAt === null || !Number.isFinite(keepUntil)) {
    await cache.delete(READY_COPY_KEY);
    return undefined;
  }
  const watermark = await readClockWatermark(storage);
  const rollback =
    Number.isSafeInteger(now) &&
    [deviceSavedAt, watermark.kind === "valid" ? watermark.at : null].some(
      (observedAt) => observedAt !== null && now < observedAt,
    );
  if (rollback) {
    return new Response(snapshot.rollback, { headers: documentHeaders("rollback") });
  }
  if (watermark.kind === "valid") await observeReadyPageClock(storage, now);
  // Rebase wall-clock elapsed time onto the trusted server generation instant.
  if (snapshot.generatedAt + (now - deviceSavedAt) > keepUntil) {
    await cache.delete(READY_COPY_KEY);
    return undefined;
  }
  // Recheck after asynchronous body parsing: cancellation may persist its
  // marker while this fallback was preparing the response.
  if (!(await stillValid())) return undefined;
  return watermark.kind === "valid"
    ? new Response(snapshot.saved, { headers: documentHeaders("known") })
    : new Response(snapshot.unverified, { headers: documentHeaders("unverified") });
}

/**
 * Drop the kept copy if it is `path`'s: the seat it was for has just been
 * cancelled. Writes a durable epoch first, so saves begun before it store
 * nothing (#2979), and a forget that cannot finish deletes every copy on the
 * phone rather than leave this one: never throws.
 */
async function writeForgetMarker(
  storage: CacheStorage,
  cancellationEpoch: string,
  cancelledPathHash: string,
  latest: Response | undefined,
): Promise<boolean> {
  try {
    const markers = await storage.open(READY_FORGOTTEN_CACHE_NAME);
    const readyCache = await storage.open(READY_CACHE_NAME);
    const cached = await readyCache.match(READY_COPY_KEY);
    const previousCancelledPathHash = latest?.headers.get(REQUEST_CANCELLED_PATH_HASH_HEADER) ?? "";
    const previousCancelledVersion = latest?.headers.get(REQUEST_CANCELLED_VERSION_HEADER) ?? "";
    const cachedHash = cached?.headers.get(PATH_HASH_HEADER) ?? "";
    // Keep the previous cancellation while the one kept copy is still its path's.
    const preserveCachedCancellation =
      previousCancelledPathHash !== "" &&
      cachedHash === previousCancelledPathHash &&
      cachedHash !== cancelledPathHash;
    const effectiveCancelledPathHash = preserveCachedCancellation
      ? previousCancelledPathHash
      : cancelledPathHash;
    const effectiveCancelledVersion = preserveCachedCancellation
      ? previousCancelledVersion
      : cancellationEpoch;
    const preserveRequest =
      latest &&
      latest.headers.get(REQUEST_PATH_HASH_HEADER) !== "" &&
      latest.headers.get(REQUEST_PATH_HASH_HEADER) !== cancelledPathHash;
    const requestId = preserveRequest ? latest.headers.get(REQUEST_ID_HEADER) : crypto.randomUUID();
    const requestPathHash = preserveRequest ? latest.headers.get(REQUEST_PATH_HASH_HEADER) : "";
    const requestForgottenVersion = preserveRequest
      ? latest.headers.get(REQUEST_FORGOTTEN_VERSION_HEADER)
      : cancellationEpoch;
    // Replace the request record atomically: this rejects every older response
    // when the forgotten path owned it, while retaining an unrelated current
    // token. Cancellation state remains path-scoped in this same bounded slot.
    await markers.put(
      LATEST_REQUEST_KEY,
      new Response(null, {
        headers: {
          [REQUEST_ID_HEADER]: requestId ?? crypto.randomUUID(),
          [REQUEST_PATH_HASH_HEADER]: requestPathHash ?? "",
          [REQUEST_FORGOTTEN_VERSION_HEADER]: requestForgottenVersion ?? cancellationEpoch,
          [REQUEST_CANCELLED_PATH_HASH_HEADER]: effectiveCancelledPathHash,
          [REQUEST_CANCELLED_VERSION_HEADER]: effectiveCancelledVersion,
        },
      }),
    );
    if (!preserveRequest) localLatestRequest = null;
    return true;
  } catch {
    return false;
  }
}

async function deleteForgottenCopy(storage: CacheStorage, path: string): Promise<void> {
  const hash = await pathHash(path);
  const cache = await storage.open(READY_CACHE_NAME);
  const cached = await cache.match(READY_COPY_KEY);
  if (cached?.headers.get(PATH_HASH_HEADER) === hash) await cache.delete(READY_COPY_KEY);
}

/** Clear a terminal path in this worker even when request-order storage failed. */
async function forgetTerminalReadyPath(
  storage: CacheStorage,
  path: string,
  hash: string,
): Promise<boolean> {
  if (localLatestRequest?.pathHash === hash) {
    locallyInvalidatedRequestId = localLatestRequest.requestId;
  }
  const invalidated = serializeReadyOrder(async () => {
    try {
      const markers = await storage.open(READY_FORGOTTEN_CACHE_NAME);
      const latest = await markers.match(LATEST_REQUEST_KEY);
      // Preserve a different token's request fields while recording this
      // terminal path for fallback's crash-window check.
      const durable = await writeForgetMarker(storage, crypto.randomUUID(), hash, latest);
      // If persistence failed, block the current same-path request ID in this
      // worker. The marker write is serialized with starts, so the next request
      // can replace this single local invalidation record.
      if (!durable && latest) {
        locallyInvalidatedRequestId = latest.headers.get(REQUEST_ID_HEADER);
      }
      return durable;
    } catch {
      // A marker read failure cannot establish which token owns the slot. Do
      // not advance the global epoch; path-scoped deletion below is still safe.
      return false;
    }
  });
  return serializeReadyPublication(async () => {
    const durable = await invalidated;
    try {
      await deleteForgottenCopy(storage, path);
    } catch {
      await storage.delete(READY_CACHE_NAME).catch(() => false);
      return false;
    }
    return durable;
  });
}

/** Drop the saved page and durably invalidate saves that began before it. */
export function forgetReadyPage(
  storage: CacheStorage,
  path: string,
  _now: number,
): Promise<boolean> {
  // Close the same-worker validation/write window immediately, scoped to the
  // request that currently owns this path. A different token is untouched.
  if (localLatestRequest?.path === path) {
    locallyInvalidatedRequestId = localLatestRequest.requestId;
  }
  const invalidated = pathHash(path).then((hash) =>
    serializeReadyOrder(async () => {
      try {
        const markers = await storage.open(READY_FORGOTTEN_CACHE_NAME);
        const latest = await markers.match(LATEST_REQUEST_KEY);
        // A different token owns the one-copy slot. Its request stays current;
        // an older response for this path is already rejected by request ID.
        if (!latest) return writeForgetMarker(storage, crypto.randomUUID(), hash, latest);
        if (latest.headers.get(REQUEST_PATH_HASH_HEADER) === hash) {
          locallyInvalidatedRequestId = latest.headers.get(REQUEST_ID_HEADER);
        }
        return writeForgetMarker(storage, crypto.randomUUID(), hash, latest);
      } catch {
        return false;
      }
    }),
  );
  return serializeReadyPublication(async () => {
    if (!(await invalidated)) {
      // The marker write failed, so report the limit and delete only this
      // path's copy. A different token may already own the shared slot.
      try {
        await deleteForgottenCopy(storage, path);
      } catch {
        await storage.delete(READY_CACHE_NAME).catch(() => false);
      }
      return false;
    }
    try {
      await deleteForgottenCopy(storage, path);
      return true;
    } catch {
      await storage.delete(READY_CACHE_NAME).catch(() => false);
      return false;
    }
  });
}

/**
 * The page's own stylesheets (`/_next/static/**.css`), so an offline copy
 * reads as the page rather than as bare HTML. No scripts: the copy keeps none
 * (issue #3003), and its inline streamed markup renders without them.
 */
export function readyPageStylesheets(html: string, origin: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/href="([^"#?]*\/_next\/static\/[^"?#]+\.css)"/g)) {
    const url = new URL(match[1] ?? "", origin);
    if (url.origin === origin) paths.add(url.pathname);
  }
  return [...paths];
}
