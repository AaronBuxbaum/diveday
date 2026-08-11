/**
 * Split out from `./index.ts` with no server-only imports (same reasoning as
 * `limits.ts`, CR-011): `index.ts` pulls in `sharp` via `process-image.ts`,
 * which has no business in a browser bundle. A "use client" component that
 * only needs to ask "is this URL one our own blob store could have produced?"
 * imports this file directly instead of the barrel, so that question never
 * drags `sharp` along with it.
 */

/**
 * Vercel Blob's public object URLs always resolve under this suffix (a
 * per-store subdomain of `blob.vercel-storage.com`, distinct from the API
 * host `blob.vercel-storage.com` itself that `PUT`/`delete` calls target).
 * Used to tell a genuinely stored object apart from a URL that only *looks*
 * like one but was never written by this seam — a bundled template asset
 * (`/dive-sites/...`, root-relative — see `src/lib/courses.ts`) or a legacy
 * pasted external URL from before uploads existed. Queuing either of those
 * for provider deletion can never succeed: the provider has never heard of
 * them, so the delete would fail every retry forever (CR-012 review finding).
 *
 * Also the host `next.config.ts`'s `images.remotePatterns` allowlists for
 * `next/image` optimization — a URL that fails this check is rendered
 * `unoptimized` (or as a plain `<img>`) instead, since next/image throws for
 * a remote host outside its configured patterns.
 */
const BLOB_PUBLIC_HOSTNAME_SUFFIX = ".public.blob.vercel-storage.com";

/** Whether `url` is an object this seam's own provider could plausibly have stored. */
export function isManagedBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(BLOB_PUBLIC_HOSTNAME_SUFFIX);
  } catch {
    return false;
  }
}
