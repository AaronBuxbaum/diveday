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
 * - **The device clock never makes the copy current**: the offline note names
 *   the server save time and says details may have changed; older copies with
 *   no trusted time say so. A detected rollback replaces the page with a
 *   warning. A worker cannot observe clock changes while it receives no
 *   events, so even a timed copy remains a saved snapshot, not live readiness.
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

import {
  READY_CACHE_NAME,
  READY_FORGOTTEN_CACHE_NAME,
  READY_KEEP_UNTIL_META,
  READY_OFFLINE_NOTE_ATTR,
  READY_SERVER_SAVED_AT_META,
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
const FORGOTTEN_AT_HEADER = "x-diveday-forgotten-at";
/** A forget marker's key: a fixed prefix and the path's hash, never the token. */
const FORGOTTEN_KEY_PREFIX = "/ready/forgotten/";
const KEEP_UNTIL_HEADER = "x-diveday-keep-until";
const SERVER_SAVED_AT_HEADER = "x-diveday-server-saved-at";
const DEVICE_SAVED_AT_HEADER = "x-diveday-device-saved-at";
const CLOCK_WATERMARK_HEADER = "x-diveday-clock-watermark";
const READY_CLOCK_CACHE_NAME = "diveday-ready-clock-v1";
const READY_CLOCK_KEY = "/ready/clock-observation";
const READY_CLOCK_STATE_HEADER = "x-diveday-ready-copy-time-state";
const SERVER_TIME_PLACEHOLDER = "__DIVEDAY_SERVER_SAVED_AT__";

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
const SERVER_SAVED_AT_PATTERN = new RegExp(
  `<meta name="${READY_SERVER_SAVED_AT_META}" content="(\\d+)"`,
);

/** The token in a readiness path (`/ready/<token>`). */
function tokenOf(path: string): string {
  return path.slice("/ready/".length);
}

function numericHeader(response: Response, name: string): number | null {
  const value = Number(response.headers.get(name));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function serverTimeFrom(response: Response, html: string): number | null {
  const metaTime = Number(html.match(SERVER_SAVED_AT_PATTERN)?.[1] ?? Number.NaN);
  if (Number.isFinite(metaTime) && metaTime > 0) return metaTime;
  const value = response.headers.get("date");
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > 0 ? time : null;
}

function formatServerTime(time: number): string {
  return `${new Date(time)
    .toISOString()
    .replace("T", " ")
    .replace(/\.000Z$/, " UTC")
    .replace(/Z$/, " UTC")}`;
}

function servedCopyHeaders(
  response: Response,
  clockState: "known" | "unknown" | "rollback",
): Headers {
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
  headers.set(READY_CLOCK_STATE_HEADER, clockState);
  return headers;
}

type ClockWatermark = { kind: "missing" | "corrupt" } | { kind: "valid"; at: number };

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

/** Persist the highest readiness-worker wall-clock reading, across worker restarts. */
export async function observeReadyPageClock(storage: CacheStorage, now: number): Promise<void> {
  if (!Number.isFinite(now) || now <= 0) return;
  try {
    const cache = await storage.open(READY_CLOCK_CACHE_NAME);
    const marker = await cache.match(READY_CLOCK_KEY);
    if (marker) {
      const previous = numericHeader(marker, CLOCK_WATERMARK_HEADER);
      // An unreadable marker may conceal a higher observation. Preserve it and
      // let the page show its unknown-time warning instead of lowering it.
      if (previous === null || now <= previous) return;
    }
    await cache.put(
      READY_CLOCK_KEY,
      new Response(null, { headers: { [CLOCK_WATERMARK_HEADER]: String(now) } }),
    );
  } catch {
    // Storage loss is surfaced as unverified time on the next fallback.
  }
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

/**
 * Whether `path` was forgotten at or after `requestedAt`: a page fetched
 * before a cancel is the pre-cancel page, however late it answers (#2979).
 */
async function forgottenSince(
  storage: CacheStorage,
  hash: string,
  requestedAt: number,
): Promise<boolean> {
  const markers = await storage.open(READY_FORGOTTEN_CACHE_NAME);
  const marker = await markers.match(`${FORGOTTEN_KEY_PREFIX}${hash}`);
  const at = Number(marker?.headers.get(FORGOTTEN_AT_HEADER));
  return Number.isFinite(at) && marker !== undefined && at >= requestedAt;
}

// Only publication is serialized; a slow asset fetch never blocks a newer save.
let readyPublication: Promise<unknown> = Promise.resolve();
function publishReadyCopy(write: () => Promise<boolean>): Promise<boolean> {
  const next = readyPublication.then(write, write);
  readyPublication = next.catch(() => {});
  return next;
}

/**
 * Keep `response` as the one copy for `path`, replacing whatever was kept.
 * Reads the body (pass a clone). Returns whether it was kept; a page that
 * names no keep-until, or one already past, clears the copy.
 *
 * `requestedAt` is when the fetch that produced `response` began; a forget
 * of this path at or after it (a cancel landing first) means nothing is kept.
 */
export async function saveReadyPage(
  storage: CacheStorage,
  path: string,
  response: Response,
  now: number,
  requestedAt: number = now,
  prepareAssets?: (html: string) => Promise<void>,
  mayPublish: () => boolean = () => true,
  observationTime: () => number = () => now,
): Promise<boolean> {
  if (!storable(response)) return false;
  // A body of its own, so the copy is complete before anything is replaced.
  const html = new TextDecoder().decode(await response.arrayBuffer());
  const named = Number(html.match(KEEP_UNTIL_PATTERN)?.[1] ?? Number.NaN);
  const cache = await storage.open(READY_CACHE_NAME);
  if (!Number.isFinite(named) || named <= now) {
    return publishReadyCopy(async () => {
      // Observed terminal truth always forgets this path, including an older
      // response. Only the current request may clear another path's copy.
      await forgetReadyPage(storage, path, observationTime());
      if (mayPublish()) await clearCopies(cache);
      return false;
    });
  }
  const headers = new Headers(response.headers);
  headers.set(KEEP_UNTIL_HEADER, String(Math.min(named, now + READY_COPY_MAX_AGE_MS)));
  headers.set(DEVICE_SAVED_AT_HEADER, String(now));
  const serverSavedAt = serverTimeFrom(response, html);
  if (serverSavedAt !== null) headers.set(SERVER_SAVED_AT_HEADER, String(serverSavedAt));
  await observeReadyPageClock(storage, now);
  const hash = await pathHash(path);
  if (await forgottenSince(storage, hash, requestedAt)) return false;
  headers.set(PATH_HASH_HEADER, hash);
  // The page's links carry the token; a same-origin script reading the stored
  // body must not recover it (residual D1), so it is put back on the way out.
  // Every other capability on the page is dropped for good: the Flight
  // payload whole (#3003), then a claim link, a checkout link, a bound
  // action's fields and a recap token in the markup (#2693).
  const copy = new Response(
    withoutClientRuntime(html)
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
  return publishReadyCopy(async () => {
    if (await forgottenSince(storage, hash, requestedAt)) return false;
    if (!mayPublish()) return false;
    await cache.put(READY_COPY_KEY, copy);
    // Forgetting invalidates the copy even during its write. A newer request
    // alone leaves this complete copy until its prepared replacement publishes.
    // The queue keeps this cleanup ahead of any newer publication.
    if (await forgottenSince(storage, hash, requestedAt)) {
      const kept = await cache.match(READY_COPY_KEY);
      if (kept?.headers.get(PATH_HASH_HEADER) === hash) await cache.delete(READY_COPY_KEY);
      return false;
    }
    await clearCopies(cache, READY_COPY_KEY);
    return mayPublish();
  });
}

/** The kept copy for `path`, if there is one and the observed clock is usable. */
export async function readyPageFallback(
  storage: CacheStorage,
  path: string,
  now: number,
): Promise<Response | undefined> {
  const cache = await storage.open(READY_CACHE_NAME);
  const cached = await cache.match(READY_COPY_KEY);
  if (!cached) return undefined;
  if (cached.headers.get(PATH_HASH_HEADER) !== (await pathHash(path))) return undefined;

  const serverSavedAt = numericHeader(cached, SERVER_SAVED_AT_HEADER);
  const deviceSavedAt = numericHeader(cached, DEVICE_SAVED_AT_HEADER);
  const watermark = await readClockWatermark(storage);
  const rollback =
    Number.isFinite(now) &&
    [serverSavedAt, deviceSavedAt, watermark.kind === "valid" ? watermark.at : null].some(
      (observedAt) => observedAt !== null && now < observedAt,
    );
  if (rollback) {
    const warning = cached
      .clone()
      .text()
      .then((html) => rollbackWarningDocument(html, serverSavedAt));
    return new Response(await warning, {
      status: cached.status,
      statusText: cached.statusText,
      headers: servedCopyHeaders(cached, "rollback"),
    });
  }

  const keepUntil = Number(cached.headers.get(KEEP_UNTIL_HEADER));
  if (!Number.isFinite(keepUntil) || (Number.isFinite(now) && now > keepUntil)) {
    await cache.delete(READY_COPY_KEY);
    return undefined;
  }
  await observeReadyPageClock(storage, now);
  const verifiedTime =
    Number.isFinite(now) &&
    serverSavedAt !== null &&
    deviceSavedAt !== null &&
    watermark.kind === "valid";
  let html = (await cached.text()).replaceAll(TOKEN_PLACEHOLDER, tokenOf(path));
  const headers = servedCopyHeaders(cached, verifiedTime ? "known" : "unknown");
  if (verifiedTime) {
    html = revealMarked(html, "data-ready-clock-saved-note").replaceAll(
      SERVER_TIME_PLACEHOLDER,
      formatServerTime(serverSavedAt),
    );
  } else {
    html = revealMarked(html, "data-ready-clock-unknown-note");
  }
  return new Response(html, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

function revealMarked(html: string, attribute: string): string {
  const openTag = new RegExp(
    `(<(?:p|main|section)\\b(?=[^>]*\\b${attribute}="")[^>]*?)\\s+hidden(?:="")?`,
    "i",
  );
  return html.replace(openTag, "$1");
}

function rollbackWarningDocument(html: string, serverSavedAt: number | null): string {
  const marker = html.match(
    /<section\b(?=[^>]*\bdata-ready-clock-rollback="")[^>]*>[\s\S]*?<\/section>/i,
  )?.[0];
  const body = html.match(/<body\b[^>]*>[\s\S]*?<\/body>/i)?.[0];
  if (!marker) return html;

  let warning = marker.replace(/\s+hidden(?:="")?/, "");
  if (serverSavedAt !== null) {
    warning = revealMarked(warning, "data-ready-clock-rollback-saved").replaceAll(
      SERVER_TIME_PLACEHOLDER,
      formatServerTime(serverSavedAt),
    );
  } else {
    warning = revealMarked(warning, "data-ready-clock-rollback-unknown");
  }
  const visibleWarning = warning.replace(/\s+hidden(?:="")?/g, "");
  if (!body) return `<main>${visibleWarning}</main>`;
  const replacementBody = body.replace(
    /(<body\b[^>]*>)[\s\S]*?(<\/body>)/i,
    (_match, open: string, close: string) => `${open}<main>${visibleWarning}</main>${close}`,
  );
  return html.replace(body, replacementBody);
}

/**
 * Drop the kept copy if it is `path`'s: the seat it was for has just been
 * cancelled. Notes the moment first, so a save whose fetch began before it
 * stores nothing (#2979), and a forget that cannot finish deletes every copy
 * on the phone rather than leave this one: never throws.
 */
export async function forgetReadyPage(
  storage: CacheStorage,
  path: string,
  now: number,
): Promise<void> {
  try {
    const hash = await pathHash(path);
    const markers = await storage.open(READY_FORGOTTEN_CACHE_NAME);
    await markers.put(
      `${FORGOTTEN_KEY_PREFIX}${hash}`,
      new Response(null, { headers: { [FORGOTTEN_AT_HEADER]: String(now) } }),
    );
    // Old markers go: no fetch outlives the longest copy.
    for (const request of await markers.keys()) {
      const marker = await markers.match(request);
      const at = Number(marker?.headers.get(FORGOTTEN_AT_HEADER));
      if (!Number.isFinite(at) || at < now - READY_COPY_MAX_AGE_MS) await markers.delete(request);
    }
    const cache = await storage.open(READY_CACHE_NAME);
    const cached = await cache.match(READY_COPY_KEY);
    if (cached && cached.headers.get(PATH_HASH_HEADER) === hash) {
      await cache.delete(READY_COPY_KEY);
    }
  } catch {
    await storage.delete(READY_CACHE_NAME).catch(() => false);
  }
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
