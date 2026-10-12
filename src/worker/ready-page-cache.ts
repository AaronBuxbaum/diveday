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
 * - **One copy, the last one rendered**: saving a page deletes every other,
 *   so a phone that opened two bookings holds only the newer.
 * - **Read-only, network-first**: a cached copy is served only when `fetch`
 *   fails. Its forms post to the server like any page and fail offline like
 *   any page; nothing is queued.
 * - **Bounded in time**: a copy older than {@link READY_COPY_MAX_AGE_MS} is
 *   deleted rather than served.
 */

export const READY_CACHE_NAME = "diveday-ready-page-v1";

/**
 * A readiness link and nothing else: `/ready/` and one bearer token
 * (`createBearerToken`, 32 random bytes as base64url, 43 characters).
 */
const READY_PAGE_PATTERN = /^\/ready\/[A-Za-z0-9_-]{43}$/;

/** Two weeks: past any trip a diver is packing for, short of last season's. */
export const READY_COPY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const SAVED_AT_HEADER = "x-diveday-saved-at";

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
 * Reads the body (pass a clone). Returns whether it was kept.
 */
export async function saveReadyPage(
  storage: CacheStorage,
  path: string,
  response: Response,
  now: number,
): Promise<boolean> {
  if (!storable(response)) return false;
  const headers = new Headers(response.headers);
  headers.set(SAVED_AT_HEADER, String(now));
  // A body of its own, so the copy is complete before anything is replaced.
  const body = await response.arrayBuffer();
  const copy = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cache = await storage.open(READY_CACHE_NAME);
  for (const request of await cache.keys()) {
    if (new URL(request.url).pathname !== path) await cache.delete(request);
  }
  await cache.put(path, copy);
  return true;
}

/** The kept copy for `path`, if there is one young enough to serve. */
export async function readyPageFallback(
  storage: CacheStorage,
  path: string,
  now: number,
): Promise<Response | undefined> {
  const cache = await storage.open(READY_CACHE_NAME);
  const cached = await cache.match(path);
  if (!cached) return undefined;
  const savedAt = Number(cached.headers.get(SAVED_AT_HEADER));
  if (!Number.isFinite(savedAt) || now - savedAt > READY_COPY_MAX_AGE_MS) {
    await cache.delete(path);
    return undefined;
  }
  return cached;
}

/**
 * The page's own stylesheets (`/_next/static/**.css`), so an offline copy
 * reads as the page rather than as bare HTML. Scripts are left to the worker's
 * ordinary static-asset cache: the copy is read-only, and the inline streamed
 * markup renders without them.
 */
export function readyPageStylesheets(html: string, origin: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/href="([^"#?]*\/_next\/static\/[^"?#]+\.css)"/g)) {
    const url = new URL(match[1] ?? "", origin);
    if (url.origin === origin) paths.add(url.pathname);
  }
  return [...paths];
}
