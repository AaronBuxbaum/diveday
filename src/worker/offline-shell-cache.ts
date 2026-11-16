/**
 * Writing the offline shell into the cache, from an explicit asset list.
 *
 * The list is generated at build time from the production build's own route
 * manifest (`scripts/offline-shell-assets.mjs`) and injected into the worker as
 * `__OFFLINE_SHELL_BUILD__`. This module used to find the assets by parsing
 * the shell HTML and scanning minified chunks for lazy chunk names; that was a
 * dependency on the shape of the framework's output, and a miss left a crew
 * member's offline screen in the error boundary.
 *
 * It takes its environment as arguments so it is tested without a worker.
 */
export interface OfflineShellCacheEnv {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  caches: CacheStorage;
  cacheName: string;
  shellPath: string;
  /**
   * The production build this worker was generated from: its id and its
   * same-origin `/_next/static/...` list. `null` in dev, where only the shell
   * document is precached and nothing is compared.
   */
  build: { id: string; assets: readonly string[] } | null;
}

/** How many build assets are fetched at once. */
const FETCH_BATCH = 6;

/** The paths this build's cache already holds, from one read of its keys. */
async function heldAssets(env: OfflineShellCacheEnv): Promise<Set<string>> {
  if (!(await env.caches.has(env.cacheName))) return new Set();
  const cache = await env.caches.open(env.cacheName);
  return new Set(
    (await cache.keys()).map((request) => {
      const url = new URL(request.url, "https://offline.invalid");
      return `${url.pathname}${url.search}`;
    }),
  );
}

/** The build id the root layout writes into every document (`<meta name="diveday-build">`). */
export function shellBuildId(html: string): string | null {
  const tag = /<meta\b[^>]*\bname="diveday-build"[^>]*>/i.exec(html)?.[0];
  return tag ? (/\bcontent="([^"]*)"/i.exec(tag)?.[1] ?? null) : null;
}

/**
 * Fetch the shell and every listed asset, and only then write anything.
 *
 * The shell and the list must be the same build. The list is baked into this
 * worker at its build; the shell is whatever the network answers now, which
 * after a deploy is a newer build whose chunks are not on the list. A shell
 * whose build id differs rejects the install (the old worker and cache keep
 * serving) instead of pairing new HTML with old chunks. Assets are fetched with
 * `cache: "reload"` so an old immutable chunk in the HTTP cache cannot answer
 * for one the server no longer has.
 *
 * All-or-nothing on purpose: a deploy landing between requests, or a flaky
 * connection, must never overwrite a working copy with new HTML that points at
 * assets that were never cached. A listed asset that cannot be fetched fails
 * the whole save, so a missing chunk is a loud failed install (the previous
 * worker and cache keep serving) rather than a silently broken offline screen.
 *
 * Assets are written before the shell that references them, so a write failure
 * (quota, eviction) leaves the previous shell in place. Asset names are content
 * hashes, so an interrupted write only adds files the old shell never names.
 *
 * The same names make an asset already in this cache the right bytes (the cache
 * name carries the build id), so only the ones it lacks are fetched; the shell
 * document is fetched every time.
 */
export async function cacheOfflineShell(env: OfflineShellCacheEnv): Promise<void> {
  const response = await env.fetch(env.shellPath, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Offline manifest shell could not be loaded");
  const build = env.build;
  if (build) {
    const served = shellBuildId(await response.clone().text());
    if (served !== build.id) {
      throw new Error(
        `Offline manifest shell is build ${served ?? "unknown"}, not this worker's build ${build.id}`,
      );
    }
  }
  const held = await heldAssets(env);
  const missing = (build?.assets ?? []).filter((asset) => !held.has(asset));
  // A few at a time: hundreds of chunks at once starve a boat tablet's connection and fail the
  // whole install on a timeout.
  const entries: [string, Response][] = [];
  for (let start = 0; start < missing.length; start += FETCH_BATCH) {
    entries.push(
      ...(await Promise.all(
        missing.slice(start, start + FETCH_BATCH).map(async (asset): Promise<[string, Response]> => {
          const assetResponse = await env.fetch(asset, { cache: "reload" });
          if (!assetResponse.ok) {
            throw new Error(`Offline manifest asset ${asset} could not be loaded`);
          }
          return [asset, assetResponse];
        }),
      )),
    );
  }
  const cache = await env.caches.open(env.cacheName);
  await Promise.all(entries.map(([asset, assetResponse]) => cache.put(asset, assetResponse)));
  await cache.put(env.shellPath, response);
}
