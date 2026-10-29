/**
 * **The diver's trip-prep page, kept on their own phone** — the last copy of
 * `/ready/<token>` this browser rendered, served only when the network fails.
 *
 * At a marina with no signal the diver had the printed pass or nothing; the
 * page with "Where to go", the pass and "Running late" was a live page. This
 * keeps exactly one copy of it, under rules chosen so the copy can never be a
 * way in that the link itself was not:
 *
 * - **Only from a registration scoped to `/ready/`** (the caller checks): the
 *   staff worker at `/` never stores one, so a shared shop tablet that opens a
 *   diver's link through the staff app keeps nothing.
 * - **Only the page itself, same origin, by its exact path**: the token in the
 *   path *is* the capability, so the cache answers only someone who already
 *   holds it. No query string, nothing under it (`/forms`), no redirect.
 * - **One copy, the last one rendered, under a key that names no token**
 *   (security review of layer 8, D1): Cache Storage is origin-wide and any
 *   same-origin script can list its keys, so the copy lives at
 *   {@link READY_COPY_KEY} and carries only a SHA-256 of its path. A request
 *   is answered only when its own path hashes to the same value, so a phone
 *   that opened two bookings holds only the newer.
 * - **No other capability rides along** (issue #2693): a party claim link, a
 *   pending tip's Stripe checkout link, a bound server action's `$ACTION_*`
 *   fields and a recap token are dropped from the stored body for good.
 * - **No Flight payload and no client runtime** (issue #3003): React flushes
 *   the payload in 4096-byte views cut at any byte, and Next writes each as
 *   its own `self.__next_f.push` script, so a token straddling a cut reaches
 *   the page in two halves that no pattern above matches. The copy keeps none
 *   of those scripts, and none of the page's external scripts either: with no
 *   payload the runtime could only fail to hydrate. What is kept is the
 *   server's markup and React's own streaming instructions, which put each
 *   Suspense boundary's content in place, so the copy reads as the page did
 *   and taps nothing that needs signal. Its "No signal" line is drawn by the
 *   server, hidden, and shown here ({@link READY_OFFLINE_NOTE_ATTR}).
 * - **The diver can remove it**: "Remove saved copy" on the page, and every
 *   staff sign-out, run `forgetReadyPageCopy` (`src/lib/ready-offline.ts`).
 * - **Read-only, network-first**: a cached copy is served only when `fetch`
 *   fails. Its forms post to the server like any page and fail offline like
 *   any page; nothing is queued.
 * - **Bounded by the trip, not only by the clock** (D2): the live page names
 *   the instant its copy expires ({@link READY_KEEP_UNTIL_META}: a day after
 *   the boat is due back), capped at {@link READY_COPY_MAX_AGE_MS}. A page
 *   that names none (a cancelled booking, a departure called off, a dead link)
 *   clears the copy instead of replacing it, and a cancelled landing
 *   forgets it outright: by navigation, or by the cancelled card asking the
 *   worker when the cancel's redirect was not one (#2979). A save whose fetch
 *   began before that forget stores nothing.
 *
 * **A residual we accept** (issue #2478, decided 2026-10-16): a staff cancel
 * or a blow-out (`src/db/blowouts.ts`) reaches the copy only when the diver
 * next opens the link online. A phone that never does keeps showing the page
 * until its date. A push could drop the copy, but divers have no push
 * subscription (web push serves staff manifests, ADR 20260804-manifest-web-push)
 * and a diver offline at the marina is the one phone a push cannot reach, so
 * the date above is the bound. The e2e spec `e2e/ready-offline.spec.ts` pins
 * the two ends: the copy shows offline, and a `?cancelled=` landing clears it.
 */

import { LEGACY_READY_BANNER_COPY } from "@/i18n/ready-offline-legacy";
import { keepUnitsWhole } from "@/lib/date-parts";
import {
  READY_CACHE_NAME,
  READY_COPY_GENERATED_AT_ATTR,
  READY_COPY_GENERATED_AT_META,
  READY_COPY_LOCALE_META,
  READY_COPY_TIME_ZONE_META,
  READY_COPY_VERSION,
  READY_COPY_VERSION_META,
  READY_FORGOTTEN_CACHE_NAME,
  READY_KEEP_UNTIL_META,
  READY_OFFLINE_GENERATED_AT_PLACEHOLDER,
  READY_OFFLINE_NOTE_ATTR,
  READY_ROLLBACK_SAVED_AT_PLACEHOLDER,
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
const LEGACY_FORGOTTEN_KEY_PREFIX = "/ready/forgotten/";
const LEGACY_FORGOTTEN_VERSION_HEADER = "x-diveday-forgotten-version";
const LEGACY_FORGOTTEN_AT_HEADER = "x-diveday-forgotten-at";
const KEEP_UNTIL_HEADER = "x-diveday-keep-until";
const DEVICE_SAVED_AT_HEADER = "x-diveday-device-saved-at";
const SERVER_SAVED_AT_HEADER = "x-diveday-server-saved-at";
const CLOCK_WATERMARK_HEADER = "x-diveday-clock-watermark";
const READY_CLOCK_CACHE_NAME = "diveday-ready-clock-v1";
const READY_CLOCK_KEY = "/ready/clock-observation";
const READY_CLOCK_STATE_HEADER = "x-diveday-ready-copy-time-state";

/** Stands in for the bearer token in the stored body; not a legal token (wrong length). */
const TOKEN_PLACEHOLDER = "__diveday_kept_token__";

/**
 * A party seat's claim link (`/claim/<token>`, relative or absolute) is a
 * second bearer token on the page. The copy keeps no claim token at all, and
 * serves this stand-in, a link that opens nothing, in its place: the real link
 * is back once the page is read online again.
 */
const CLAIM_TOKEN_PATTERN = /\/claim\/[A-Za-z0-9_-]{43}/g;
const CLAIM_REMOVED = "/claim/__diveday_claim_not_kept__";

/**
 * **No way to pay from a kept copy** (issue #2693). A pending tip's Stripe
 * checkout link opens a live checkout session, so the copy carries a link
 * that opens nothing in its place, in the HTML and in the Flight payload alike
 * (the character class stops at a JSON string's escaped quote).
 */
const CHECKOUT_LINK_PATTERN = /https:\/\/checkout\.stripe\.com\/[^"'\s<>\\]*/g;
const CHECKOUT_REMOVED = "#checkout-not-kept";

/**
 * **A bound server action's form fields** (`$ACTION_REF_*`, `$ACTION_<id>:<n>`,
 * `$ACTION_KEY`; React's `encodeFormAction`) carry the action's bound
 * arguments. The copy drops the fields whole: a kept page is read-only, and
 * hydration skips a missing hidden input.
 */
const BOUND_ACTION_FIELD_PATTERN = /<input\b[^>]*\bname="\$ACTION_[^"]*"[^>]*>/g;

/**
 * **A recap token** (`signRecapToken`: base64url of `recap:<booking>:<iat>`,
 * a dot, a 43-character signature) is what the after-state's actions are
 * bound to, so it rides in the Flight payload as well as those fields. A
 * second, 180-day bearer credential the copy never keeps (issue #2693). Its
 * payload always opens with `cmVjYXA6`, the base64url of `recap:`.
 */
const RECAP_TOKEN_PATTERN = /cmVjYXA6[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{43}/g;
const RECAP_TOKEN_REMOVED = "__diveday_recap_not_kept__";

/** Every `<script>` element, its opening tag's attributes and its inline text. */
const SCRIPT_ELEMENT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;

/**
 * **The page's scripts, minus React's streaming instructions** (issue #3003).
 * Drops every script that loads from a `src` (the client runtime, which with
 * no payload could only fail to hydrate) and every inline script that touches
 * `__next_f` (the Flight payload, where a token can sit split across two).
 * React's inline `$RC`-style instructions carry only boundary ids, and the
 * copy needs them to show anything past the loading skeleton.
 */
function withoutClientRuntime(html: string): string {
  // Until nothing more drops, so removing one element cannot join the text
  // around it into another the pass did not see.
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = previous.replace(
      SCRIPT_ELEMENT_PATTERN,
      (element, attributes: string, text: string) =>
        /\bsrc\s*=/i.test(attributes) || text.includes("__next_f") ? "" : element,
    );
  } while (current !== previous);
  return current;
}

/**
 * The page's "No signal" line, drawn by the server and hidden there
 * (`ReadyOfflineCopy`). The copy is only ever on screen when the network did
 * not answer, and it runs no script to unhide the line, so it is shown here.
 */
const OFFLINE_NOTE_HIDDEN = `${READY_OFFLINE_NOTE_ATTR}="" hidden=""`;
const OFFLINE_NOTE_SHOWN = `${READY_OFFLINE_NOTE_ATTR}=""`;

const KEEP_UNTIL_PATTERN = new RegExp(`<meta name="${READY_KEEP_UNTIL_META}" content="(\\d+)"`);

type ReadyBanner = { element: string; opening: string; text: string; closing: string };

function readyBanners(html: string): ReadyBanner[] {
  const pattern = new RegExp(
    `(<p\\b[^>]*\\b${READY_OFFLINE_NOTE_ATTR}=""[^>]*>)([^<>]*)(<\\/p>)`,
    "gi",
  );
  return [...html.matchAll(pattern)].map((match) => ({
    element: match[0],
    opening: match[1] ?? "",
    text: match[2] ?? "",
    closing: match[3] ?? "",
  }));
}

function hasAttribute(opening: string, name: string): boolean {
  return new RegExp(`\\b${name}="[^"]*"`).test(opening);
}

function singleTextBanner(html: string): ReadyBanner | undefined {
  const banners = readyBanners(html);
  const banner = banners[0];
  const allNoteMarkers = html.match(new RegExp(`\\b${READY_OFFLINE_NOTE_ATTR}=""`, "g"));
  const noteMarkers = banner?.opening.match(new RegExp(`\\b${READY_OFFLINE_NOTE_ATTR}=""`, "g"));
  if (
    banners.length !== 1 ||
    allNoteMarkers?.length !== 1 ||
    !banner ||
    noteMarkers?.length !== 1
  ) {
    return undefined;
  }
  return banner;
}

function visibleTextBanner(html: string): ReadyBanner | undefined {
  const banner = singleTextBanner(html);
  return banner && !/\shidden(?:\s|=|>)/i.test(banner.opening) ? banner : undefined;
}

function metaContent(html: string, name: string): string | undefined {
  return html.match(
    new RegExp(`<meta\\b[^>]*\\bname="${name}"[^>]*\\bcontent="([^"]*)"[^>]*>`, "i"),
  )?.[1];
}

function singleMetaContent(html: string, name: string): string | undefined {
  const matches = [
    ...html.matchAll(
      new RegExp(`<meta\\b[^>]*\\bname="${name}"[^>]*\\bcontent="([^"]*)"[^>]*>`, "gi"),
    ),
  ];
  return matches.length === 1 ? matches[0]?.[1] : undefined;
}

/** Recognize and warn on the two exact historical, localized offline banners. */
function transformLegacyReadyCopy(html: string): string | undefined {
  const banner = visibleTextBanner(html);
  if (!banner || hasAttribute(banner.opening, READY_COPY_GENERATED_AT_ATTR)) return undefined;
  const knownWarning = LEGACY_READY_BANNER_COPY.get(banner.text);
  if (!knownWarning) return undefined;
  return html.replace(
    banner.element,
    `${banner.opening}${knownWarning.savedCopyWarning}${banner.closing}`,
  );
}

/** Format the server-rendered page generation instant in the locale and shop zone. */
function readyGeneratedAtLabel(html: string, generatedAt: number): string | undefined {
  const locale = metaContent(html, READY_COPY_LOCALE_META);
  const timeZone = metaContent(html, READY_COPY_TIME_ZONE_META);
  const declaredGeneratedAt = Number(singleMetaContent(html, READY_COPY_GENERATED_AT_META));
  if (
    !locale ||
    !timeZone ||
    !Number.isSafeInteger(generatedAt) ||
    declaredGeneratedAt !== generatedAt
  ) {
    return undefined;
  }
  try {
    return keepUnitsWhole(
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
        timeZone,
      }).formatToParts(new Date(generatedAt)),
    );
  } catch {
    return undefined;
  }
}

/** The token in a readiness path (`/ready/<token>`). */
function tokenOf(path: string): string {
  return path.slice("/ready/".length);
}

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

function fallbackHeaders(response: Response, state: "known" | "unknown" | "rollback"): Headers {
  const headers = new Headers(response.headers);
  for (const name of [
    "content-length",
    "content-encoding",
    "content-md5",
    "content-range",
    "content-digest",
    "etag",
    "last-modified",
  ]) {
    headers.delete(name);
  }
  headers.set(READY_CLOCK_STATE_HEADER, state);
  return headers;
}

function revealMarked(html: string, attribute: string): string {
  const openTag = new RegExp(
    `(<(?:p|main|section)\\b(?=[^>]*\\b${attribute}="")[^>]*?)\\s+hidden(?:="")?`,
    "i",
  );
  return html.replace(openTag, "$1");
}

function escapedHTML(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function legacyRollbackDocument(html: string): string | undefined {
  const banner = visibleTextBanner(html);
  const words = banner ? LEGACY_READY_BANNER_COPY.get(banner.text) : undefined;
  if (!banner || !words) return undefined;
  const main = `<main><h1>${escapedHTML(words.clockRollbackHeading)}</h1><p>${escapedHTML(words.clockRollbackUnknown)}</p></main>`;
  const body = /<body\b[^>]*>[\s\S]*?<\/body>/i;
  return body.test(html)
    ? html.replace(body, `<body>${main}</body>`)
    : html.replace(banner.element, main);
}

function rollbackWarningDocument(html: string, generatedAt: number): string | undefined {
  const marker = html.match(
    /<section\b(?=[^>]*\bdata-ready-clock-rollback="")[^>]*>[\s\S]*?<\/section>/i,
  )?.[0];
  const body = html.match(/<body\b[^>]*>[\s\S]*?<\/body>/i)?.[0];
  if (!marker || !body) return legacyRollbackDocument(html);
  const label = readyGeneratedAtLabel(html, generatedAt);
  let warning = marker.replace(/\s+hidden(?:="")?/, "");
  if (label) {
    warning = revealMarked(warning, "data-ready-clock-rollback-saved").replaceAll(
      READY_ROLLBACK_SAVED_AT_PLACEHOLDER,
      label,
    );
  } else {
    warning = revealMarked(warning, "data-ready-clock-rollback-unknown");
  }
  const replacement = body.replace(
    /(<body\b[^>]*>)[\s\S]*?(<\/body>)/i,
    `$1<main>${warning}</main>$2`,
  );
  return html.replace(body, replacement);
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

function legacyForgottenKey(hash: string): string {
  return `${LEGACY_FORGOTTEN_KEY_PREFIX}${hash}`;
}

function legacyForgottenVersion(marker: Response | undefined, hash: string): string {
  if (!marker) return "";
  const version = marker.headers.get(LEGACY_FORGOTTEN_VERSION_HEADER);
  if (version) return version;
  const at = marker.headers.get(LEGACY_FORGOTTEN_AT_HEADER);
  return at?.trim() && Number.isSafeInteger(Number(at))
    ? `legacy-at:${at}`
    : `legacy-invalid:${hash}`;
}

async function clearLegacyForgetMarkers(markers: Cache): Promise<void> {
  for (const request of await markers.keys()) {
    if (new URL(request.url).pathname.startsWith(LEGACY_FORGOTTEN_KEY_PREFIX)) {
      await markers.delete(request);
    }
  }
}

async function isCopyInvalidated(
  storage: CacheStorage,
  hash: string,
  cached: Response,
): Promise<boolean> {
  const markers = await storage.open(READY_FORGOTTEN_CACHE_NAME);
  const latest = await markers.match(LATEST_REQUEST_KEY);
  if (latest?.headers.get(REQUEST_CANCELLED_PATH_HASH_HEADER) === hash) {
    return (
      cached.headers.get(COPY_FORGOTTEN_VERSION_HEADER) !==
      latest.headers.get(REQUEST_CANCELLED_VERSION_HEADER)
    );
  }
  const legacy = await markers.match(legacyForgottenKey(hash));
  const legacyVersion = legacyForgottenVersion(legacy, hash);
  return Boolean(legacy && cached.headers.get(COPY_FORGOTTEN_VERSION_HEADER) !== legacyVersion);
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
      const oldPathMarker = await markers.match(legacyForgottenKey(hash));
      const oldPathVersion = legacyForgottenVersion(oldPathMarker, hash);
      const cancelledPathHash = marker?.headers.get(REQUEST_CANCELLED_PATH_HASH_HEADER) ?? "";
      const cancelledVersion = marker?.headers.get(REQUEST_CANCELLED_VERSION_HEADER) ?? "";
      const readyCache = await storage.open(READY_CACHE_NAME);
      const cached = await readyCache.match(READY_COPY_KEY);
      const cachedHash = cached?.headers.get(PATH_HASH_HEADER) ?? "";
      const cachedVersion = cached?.headers.get(COPY_FORGOTTEN_VERSION_HEADER) ?? "";
      let migratedPathHash = cancelledPathHash;
      let migratedVersion = cancelledVersion;
      if (cancelledPathHash !== cachedHash && cachedHash) {
        const oldCachedMarker = await markers.match(legacyForgottenKey(cachedHash));
        const oldCachedVersion = legacyForgottenVersion(oldCachedMarker, cachedHash);
        if (oldCachedVersion && cachedVersion !== oldCachedVersion) {
          migratedPathHash = cachedHash;
          migratedVersion = oldCachedVersion;
        } else if (oldPathVersion) {
          migratedPathHash = hash;
          migratedVersion = oldPathVersion;
        }
      } else if (oldPathVersion && !cancelledPathHash) {
        migratedPathHash = hash;
        migratedVersion = oldPathVersion;
      }
      request.forgottenVersion =
        cancelledPathHash === hash
          ? cancelledVersion
          : oldPathVersion || (marker?.headers.get(REQUEST_FORGOTTEN_VERSION_HEADER) ?? "");
      await markers.put(
        LATEST_REQUEST_KEY,
        new Response(null, {
          headers: {
            [REQUEST_ID_HEADER]: request.requestId,
            [REQUEST_PATH_HASH_HEADER]: request.pathHash,
            [REQUEST_FORGOTTEN_VERSION_HEADER]: request.forgottenVersion,
            [REQUEST_CANCELLED_PATH_HASH_HEADER]: migratedPathHash,
            [REQUEST_CANCELLED_VERSION_HEADER]: migratedVersion,
          },
        }),
      );
      locallyInvalidatedRequestId = null;
      localLatestRequest = { path, pathHash: hash, requestId: request.requestId };
      request.durable = true;
      await clearLegacyForgetMarkers(markers);
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

/**
 * Keep `response` as the one copy for `path`, replacing whatever was kept.
 * Reads the body (pass a clone). Returns whether it was kept; a page that
 * names no keep-until, or one already past, clears the copy.
 *
 * `request` records whether ordering was durably captured before the fetch.
 * A nondurable request may still process terminal truth and return the live
 * response, but cannot publish a saved copy.
 */
export async function saveReadyPage(
  storage: CacheStorage,
  path: string,
  response: Response,
  now: number,
  request?: ReadyPageRequest,
  prepareAssets?: (html: string) => Promise<void>,
  mayPublish: () => boolean = () => true,
): Promise<boolean> {
  if (!storable(response)) return false;
  const hash = await pathHash(path);
  const order = request ?? (await beginReadyPageRequest(storage, path));
  if (order.pathHash !== hash) return false;
  // A body of its own, so the copy is complete before anything is replaced.
  const html = new TextDecoder().decode(await response.arrayBuffer());
  const named = Number(html.match(KEEP_UNTIL_PATTERN)?.[1] ?? Number.NaN);
  const cache = await storage.open(READY_CACHE_NAME);
  if (!Number.isFinite(named) || named <= now) {
    // Process terminal truth even without a durable request marker. Order the
    // path check and epoch write together with request starts, preventing a
    // different token from slipping between the check and global marker.
    await forgetTerminalReadyPath(storage, path, hash);
    return false;
  }
  if (!order.durable) return false;
  // Pages rendered before the saved-time format cannot be transformed safely:
  // their banner has no reliable locale/zone or age context.
  if (metaContent(html, READY_COPY_VERSION_META) !== READY_COPY_VERSION) return false;
  const generatedAt = Number(singleMetaContent(html, READY_COPY_GENERATED_AT_META));
  const generatedAtLabel = readyGeneratedAtLabel(html, generatedAt);
  const safeHtml = withoutClientRuntime(html);
  const banner = singleTextBanner(safeHtml);
  const placeholderCount = safeHtml.split(READY_OFFLINE_GENERATED_AT_PLACEHOLDER).length - 1;
  // A current-format page must have one text-only banner (hidden online), one
  // placeholder and usable locale/zone context. Keep the previous complete
  // copy if a new response is malformed.
  if (!banner) return false;
  if (
    !banner.opening.includes(OFFLINE_NOTE_HIDDEN) ||
    hasAttribute(banner.opening, READY_COPY_GENERATED_AT_ATTR) ||
    placeholderCount !== 1 ||
    !banner.text.includes(READY_OFFLINE_GENERATED_AT_PLACEHOLDER) ||
    !Number.isSafeInteger(now) ||
    generatedAtLabel === undefined
  ) {
    return false;
  }
  const timestampedBanner = `${banner.opening.replace(/>$/, ` ${READY_COPY_GENERATED_AT_ATTR}="${generatedAt}">`)}${banner.text.replace(READY_OFFLINE_GENERATED_AT_PLACEHOLDER, generatedAtLabel)}${banner.closing}`;
  const timestampedHtml = safeHtml.replace(banner.element, timestampedBanner);
  const headers = new Headers(response.headers);
  headers.set(KEEP_UNTIL_HEADER, String(Math.min(named, now + READY_COPY_MAX_AGE_MS)));
  headers.set(DEVICE_SAVED_AT_HEADER, String(now));
  const serverSavedAt = Number(singleMetaContent(html, READY_COPY_GENERATED_AT_META));
  if (Number.isSafeInteger(serverSavedAt) && serverSavedAt > 0) {
    headers.set(SERVER_SAVED_AT_HEADER, String(serverSavedAt));
  }
  await observeReadyPageClock(storage, now);
  if (!(await requestIsCurrent(storage, hash, order))) return false;
  headers.set(PATH_HASH_HEADER, hash);
  headers.set(COPY_FORGOTTEN_VERSION_HEADER, order.forgottenVersion);
  headers.set(COPY_REQUEST_ID_HEADER, order.requestId);
  // The page's links carry the token; a same-origin script reading the stored
  // body must not recover it (residual D1), so it is put back on the way out.
  // Every other capability on the page is dropped for good: the Flight
  // payload whole (#3003), then a claim link, a checkout link, a bound
  // action's fields and a recap token in the markup (#2693).
  const copy = new Response(
    timestampedHtml
      .replaceAll(OFFLINE_NOTE_HIDDEN, OFFLINE_NOTE_SHOWN)
      .replaceAll(tokenOf(path), TOKEN_PLACEHOLDER)
      .replace(CLAIM_TOKEN_PATTERN, CLAIM_REMOVED)
      .replace(CHECKOUT_LINK_PATTERN, CHECKOUT_REMOVED)
      .replace(BOUND_ACTION_FIELD_PATTERN, "")
      .replace(RECAP_TOKEN_PATTERN, RECAP_TOKEN_REMOVED),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
  // Publish the document only after its required static assets are stored.
  // Failure leaves the previous complete copy available, never a partial new one.
  await prepareAssets?.(html);
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
  try {
    if (await isCopyInvalidated(storage, hash, cached)) {
      await cache.delete(READY_COPY_KEY).catch(() => false);
      return undefined;
    }
  } catch {
    // If durable invalidation state cannot be read, do not serve a possibly
    // cancelled page offline. Legacy copies remain eligible when it is read
    // successfully and no matching cancellation is recorded.
    return undefined;
  }
  const storedHtml = await cached.text();
  const savedAtFromBody = Number(singleMetaContent(storedHtml, READY_COPY_GENERATED_AT_META));
  const serverSavedAt =
    numericHeader(cached, SERVER_SAVED_AT_HEADER) ??
    (Number.isSafeInteger(savedAtFromBody) && savedAtFromBody > 0 ? savedAtFromBody : null);
  const deviceSavedAt = numericHeader(cached, DEVICE_SAVED_AT_HEADER);
  const watermark = await readClockWatermark(storage);
  const rollback =
    Number.isSafeInteger(now) &&
    [deviceSavedAt, watermark.kind === "valid" ? watermark.at : null].some(
      (observedAt) => observedAt !== null && now < observedAt,
    );
  if (rollback) {
    const warning = rollbackWarningDocument(storedHtml, serverSavedAt ?? 0);
    if (!warning) {
      await cache.delete(READY_COPY_KEY);
      return undefined;
    }
    return new Response(warning, {
      status: cached.status,
      statusText: cached.statusText,
      headers: fallbackHeaders(cached, "rollback"),
    });
  }
  await observeReadyPageClock(storage, now);
  const keepUntil = Number(cached.headers.get(KEEP_UNTIL_HEADER));
  if (!Number.isFinite(keepUntil) || now > keepUntil) {
    await cache.delete(READY_COPY_KEY);
    return undefined;
  }
  let copyHtml = storedHtml;
  if (metaContent(storedHtml, READY_COPY_VERSION_META) === READY_COPY_VERSION) {
    const banner = visibleTextBanner(storedHtml);
    const generatedAtValues = banner?.opening.match(
      new RegExp(`\\b${READY_COPY_GENERATED_AT_ATTR}="(\\d+)"`, "g"),
    );
    const generatedAt = Number(
      banner?.opening.match(new RegExp(`\\b${READY_COPY_GENERATED_AT_ATTR}="(\\d+)"`))?.[1],
    );
    const expectedLabel = readyGeneratedAtLabel(storedHtml, generatedAt);
    if (
      !banner ||
      generatedAtValues?.length !== 1 ||
      !Number.isSafeInteger(generatedAt) ||
      !expectedLabel ||
      banner.text.split(expectedLabel).length !== 2 ||
      storedHtml.includes(READY_OFFLINE_GENERATED_AT_PLACEHOLDER)
    ) {
      await cache.delete(READY_COPY_KEY);
      return undefined;
    }
  } else {
    const legacyCopy = transformLegacyReadyCopy(storedHtml);
    if (!legacyCopy) {
      // Unknown or malformed legacy copy: fail closed for this verified path.
      await cache.delete(READY_COPY_KEY);
      return undefined;
    }
    copyHtml = legacyCopy;
  }
  // Recheck after asynchronous body parsing: cancellation may persist its
  // marker while this fallback was preparing the response.
  try {
    if (await isCopyInvalidated(storage, hash, cached)) {
      await cache.delete(READY_COPY_KEY).catch(() => false);
      return undefined;
    }
  } catch {
    return undefined;
  }
  const html = copyHtml.replaceAll(TOKEN_PLACEHOLDER, tokenOf(path));
  return new Response(html, {
    status: cached.status,
    statusText: cached.statusText,
    headers: fallbackHeaders(cached, serverSavedAt !== null ? "known" : "unknown"),
  });
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
    const oldCachedMarker = cachedHash
      ? await markers.match(legacyForgottenKey(cachedHash))
      : undefined;
    const oldCachedVersion = legacyForgottenVersion(oldCachedMarker, cachedHash);
    const preservePreviousCancellation =
      previousCancelledPathHash !== "" && cachedHash === previousCancelledPathHash;
    const preserveLegacyCancellation =
      !preservePreviousCancellation &&
      cachedHash !== "" &&
      oldCachedVersion !== "" &&
      cached?.headers.get(COPY_FORGOTTEN_VERSION_HEADER) !== oldCachedVersion;
    const preserveCachedCancellation =
      cachedHash !== cancelledPathHash &&
      (preservePreviousCancellation || preserveLegacyCancellation);
    const effectiveCancelledPathHash = preserveCachedCancellation
      ? preservePreviousCancellation
        ? previousCancelledPathHash
        : cachedHash
      : cancelledPathHash;
    const effectiveCancelledVersion = preserveCachedCancellation
      ? preservePreviousCancellation
        ? previousCancelledVersion
        : oldCachedVersion
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
    // The current record now preserves any old marker needed by the one kept
    // copy, so the historical per-path tombstones can be removed.
    await clearLegacyForgetMarkers(markers);
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
