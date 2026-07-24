import { headers } from "next/headers";

export type HeaderGetter = { get(name: string): string | null };

/**
 * Best-effort caller IP, for rate-limit bucketing only — never for anything
 * security-authoritative like a redirect target or an authorization
 * decision (mirrors the "never derive a canonical value from a request
 * header" rule that governs `publicAppUrl()` in src/lib/notifications).
 *
 * Trusted-proxy policy: Vercel is the sole hosting target
 * (docs/architecture/decisions/20260718-vercel-hosting.md) and sits
 * directly in front of this app with no other customer-configurable proxy
 * hop, so `x-forwarded-for`'s first entry is the address Vercel's own edge
 * observed and can be trusted; `x-real-ip` is the fallback. Returns null
 * when neither header is present (local dev, a bare `next start`) — callers
 * should treat that as one shared "unknown" bucket, never as a reason to
 * skip rate limiting or to trust some other client-supplied override.
 */
export async function clientIp(source: HeaderGetter | null = null): Promise<string | null> {
  const list = source ?? (await headers());
  const forwarded = list.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = list.get("x-real-ip");
  return real?.trim() || null;
}
