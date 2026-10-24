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
 *   clears the copy instead of replacing it, and a `?cancelled=` landing
 *   forgets it outright.
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
  READY_KEEP_UNTIL_META,
  READY_OFFLINE_NOTE_ATTR,
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
const KEEP_UNTIL_HEADER = "x-diveday-keep-until";

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
const SCRIPT_ELEMENT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/**
 * **The page's scripts, minus React's streaming instructions** (issue #3003).
 * Drops every script that loads from a `src` (the client runtime, which with
 * no payload could only fail to hydrate) and every inline script that touches
 * `__next_f` (the Flight payload, where a token can sit split across two).
 * React's inline `$RC`-style instructions carry only boundary ids, and the
 * copy needs them to show anything past the loading skeleton.
 */
function withoutClientRuntime(html: string): string {
  return html.replace(SCRIPT_ELEMENT_PATTERN, (element, attributes: string, text: string) =>
    /\bsrc\s*=/i.test(attributes) || text.includes("__next_f") ? "" : element,
  );
}

/**
 * The page's "No signal" line, drawn by the server and hidden there
 * (`ReadyOfflineCopy`). The copy is only ever on screen when the network did
 * not answer, and it runs no script to unhide the line, so it is shown here.
 */
const OFFLINE_NOTE_HIDDEN = `${READY_OFFLINE_NOTE_ATTR}="" hidden=""`;
const OFFLINE_NOTE_SHOWN = `${READY_OFFLINE_NOTE_ATTR}=""`;

const KEEP_UNTIL_PATTERN = new RegExp(`<meta name="${READY_KEEP_UNTIL_META}" content="(\\d+)"`);

/** The token in a readiness path (`/ready/<token>`). */
function tokenOf(path: string): string {
  return path.slice("/ready/".length);
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
 * Keep `response` as the one copy for `path`, replacing whatever was kept.
 * Reads the body (pass a clone). Returns whether it was kept; a page that
 * names no keep-until, or one already past, clears the copy.
 */
export async function saveReadyPage(
  storage: CacheStorage,
  path: string,
  response: Response,
  now: number,
): Promise<boolean> {
  if (!storable(response)) return false;
  // A body of its own, so the copy is complete before anything is replaced.
  const html = new TextDecoder().decode(await response.arrayBuffer());
  const named = Number(html.match(KEEP_UNTIL_PATTERN)?.[1] ?? Number.NaN);
  const cache = await storage.open(READY_CACHE_NAME);
  if (!Number.isFinite(named) || named <= now) {
    await clearCopies(cache);
    return false;
  }
  const headers = new Headers(response.headers);
  headers.set(KEEP_UNTIL_HEADER, String(Math.min(named, now + READY_COPY_MAX_AGE_MS)));
  headers.set(PATH_HASH_HEADER, await pathHash(path));
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
  // Replace, then sweep: an offline reload landing mid-save (two saves overlap,
  // the navigation's and the page's keep request) still finds a copy.
  await cache.put(READY_COPY_KEY, copy);
  await clearCopies(cache, READY_COPY_KEY);
  return true;
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
  const keepUntil = Number(cached.headers.get(KEEP_UNTIL_HEADER));
  if (!Number.isFinite(keepUntil) || now > keepUntil) {
    await cache.delete(READY_COPY_KEY);
    return undefined;
  }
  if (cached.headers.get(PATH_HASH_HEADER) !== (await pathHash(path))) return undefined;
  const html = (await cached.text()).replaceAll(TOKEN_PLACEHOLDER, tokenOf(path));
  return new Response(html, {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}

/** Drop the kept copy if it is `path`'s: the seat it was for has just been cancelled. */
export async function forgetReadyPage(storage: CacheStorage, path: string): Promise<void> {
  const cache = await storage.open(READY_CACHE_NAME);
  const cached = await cache.match(READY_COPY_KEY);
  if (cached && cached.headers.get(PATH_HASH_HEADER) === (await pathHash(path))) {
    await cache.delete(READY_COPY_KEY);
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
