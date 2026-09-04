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

/**
 * One `next/image` remote pattern per origin our own storage could have
 * produced (issue #1358).
 *
 * `next.config.ts` allowlisted `*.s3.*.amazonaws.com`, `*.s3.amazonaws.com` and
 * `*.cloudfront.net`, each over `/**`. That is the same mistake
 * {@link managedStorageOrigins} was written to undo, one file away and two
 * years later in the reading: a suffix of a multi-tenant provider is not an
 * identity. `/_next/image?url=…` would fetch, decode, re-encode and serve any
 * object behind any CloudFront distribution or any public S3 bucket on the
 * internet — the most expensive request the app makes, available to anybody
 * with a URL and no account, with DiveDay's origin as the apparent fetcher.
 *
 * So the allowlist is now the same list the storage seam already keeps, and the
 * two cannot drift: a URL `isManagedStorageUrl` would refuse to store is a URL
 * the optimizer will not fetch.
 *
 * **https only**, matching that predicate exactly rather than carrying whatever
 * scheme the base was configured with — an optimizer that will follow one
 * cleartext origin is a downgrade the config file should not be able to
 * introduce by typo.
 *
 * **Empty when no media storage is configured, and that is the whole answer for
 * a developer with none.** Every image the seed and the bundled templates carry
 * is a root-relative path under `public/` (`/dive-sites/<file>.jpg`), which
 * never touches `remotePatterns`; and with no storage configured an upload
 * returns `not_configured` and stores no URL at all, so there is nothing a
 * remote pattern could be needed for. The same fail-closed reasoning as
 * {@link isManagedStorageUrl}, in the same shape.
 */
export function managedImageRemotePatterns(
  env: StorageEnvironment = process.env,
): { protocol: "https"; hostname: string; port: string; pathname: "/**" }[] {
  return managedStorageOrigins(env).flatMap((origin) => {
    const url = new URL(origin);
    if (url.protocol !== "https:") return [];
    return [
      {
        protocol: "https" as const,
        hostname: url.hostname,
        port: url.port,
        pathname: "/**" as const,
      },
    ];
  });
}
