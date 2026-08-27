/**
 * Split out from `./index.ts` with no server-only imports (same reasoning as
 * `limits.ts`, CR-011): `index.ts` pulls in `sharp` via `process-image.ts`,
 * which has no business in a browser bundle. A "use client" component that
 * only needs to ask "is this URL one our own storage could have produced?"
 * imports this file directly instead of the barrel, so that question never
 * drags `sharp` along with it.
 */

type StorageEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The origins DiveDay's own media could have been written to, derived from the
 * configured bucket rather than guessed from a hostname shape.
 *
 * This used to be a suffix list — `.s3.amazonaws.com`, `.cloudfront.net` — and
 * a suffix of a multi-tenant provider is not an identity: every public S3
 * bucket and every CloudFront distribution on the internet matched, including
 * one an attacker stands up in five minutes. Three security decisions rest on
 * this predicate (the ingest allowlist that keeps third-party hosts off public
 * briefing pages, the SSRF guard on the export photo fetch, and whether a URL
 * may be queued for deletion), so a wildcard there hands all three away.
 */
export function managedStorageOrigins(env: StorageEnvironment = process.env): string[] {
  const origins: string[] = [];
  const base = env.MEDIA_PUBLIC_URL_BASE?.trim();
  if (base) {
    try {
      origins.push(new URL(base).origin);
    } catch {
      // An unparseable base is configuration this cannot rescue; skip it.
    }
  }
  const bucket = env.MEDIA_BUCKET_NAME?.trim();
  const region = env.MEDIA_AWS_REGION?.trim();
  if (bucket) {
    origins.push(`https://${bucket}.s3.amazonaws.com`);
    if (region) origins.push(`https://${bucket}.s3.${region}.amazonaws.com`);
  }
  return [...new Set(origins)];
}

/**
 * Whether `url` is an object this seam's own provider could have stored.
 *
 * Fails closed: with no media storage configured there is no origin our own
 * uploads could carry, so nothing is "managed" — which makes an unconfigured
 * environment re-store a pasted photo and queue no deletions, rather than
 * trust a host on the strength of its name.
 */
export function isManagedStorageUrl(url: string, env: StorageEnvironment = process.env): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return managedStorageOrigins(env).includes(parsed.origin);
}
