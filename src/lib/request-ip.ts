import { headers } from "next/headers";

export type HeaderGetter = { get(name: string): string | null };

/**
 * Best-effort caller IP, for rate-limit bucketing only — never for anything
 * security-authoritative like a redirect target or an authorization
 * decision (mirrors the "never derive a canonical value from a request
 * header" rule that governs `publicAppUrl()` in src/lib/notifications).
 *
 * Trusted-proxy policy: Vercel is the sole hosting target
 * (docs/architecture/decisions/20260718-vercel-hosting.md). Vercel's own
 * docs (Headers → Request headers → `x-forwarded-for`) state: "If you are
 * trying to use Vercel behind a proxy, we currently overwrite the
 * X-Forwarded-For header and do not forward external IPs. This restriction
 * is in place to prevent IP spoofing" — so a client-supplied value is
 * discarded, not appended to, and the header's first entry is Vercel's own
 * observed connecting IP. `x-vercel-forwarded-for` is preferred here anyway
 * (checked first) because Vercel's same docs note it "is identical to
 * `x-forwarded-for`. However, `x-forwarded-for` could be overwritten if
 * you're using a proxy on top of Vercel" — i.e. it stays trustworthy even
 * under a future customer-added proxy in front of Vercel, which
 * `x-forwarded-for` alone would not. `x-real-ip` (also documented as
 * identical) is the last fallback. Returns null when none of these headers
 * are present (local dev, a bare `next start`) — callers should treat that
 * as one shared "unknown" bucket, never as a reason to skip rate limiting
 * or to trust some other client-supplied override.
 */
export async function clientIp(source: HeaderGetter | null = null): Promise<string | null> {
  const list = source ?? (await headers());
  for (const name of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) {
    const value = list.get(name);
    if (!value) continue;
    const first = value.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}
