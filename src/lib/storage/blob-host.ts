/**
 * Split out from `./index.ts` with no server-only imports (same reasoning as
 * `limits.ts`, CR-011): `index.ts` pulls in `sharp` via `process-image.ts`,
 * which has no business in a browser bundle. A "use client" component that
 * only needs to ask "is this URL one our own storage could have produced?"
 * imports this file directly instead of the barrel, so that question never
 * drags `sharp` along with it.
 */

/**
 * Storage host suffixes for DiveDay-managed media (AWS S3, CloudFront, and legacy Vercel Blob).
 * Used to tell a genuinely stored object apart from a URL that only *looks*
 * like one but was never written by this seam — a bundled template asset
 * (`/dive-sites/...`, root-relative — see `src/lib/courses.ts`) or a legacy
 * pasted external URL from before uploads existed.
 */
const MANAGED_HOSTNAME_PATTERNS = [
  ".s3.amazonaws.com",
  ".public.blob.vercel-storage.com",
  ".cloudfront.net",
] as const;

/** Whether `url` is an object this seam's own provider could plausibly have stored. */
export function isManagedStorageUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (MANAGED_HOSTNAME_PATTERNS.some((pattern) => hostname.endsWith(pattern))) {
      return true;
    }
    // Also matches regional S3 endpoints like bucket.s3.us-east-1.amazonaws.com
    return /\.s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(hostname);
  } catch {
    return false;
  }
}

/** Legacy alias for {@link isManagedStorageUrl}. */
export const isManagedBlobUrl = isManagedStorageUrl;
