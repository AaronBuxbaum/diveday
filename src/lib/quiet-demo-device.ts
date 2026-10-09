import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * **A browser the founder has marked as his own, so his demo tries stay out
 * of his inbox** (docs ADR 20260805-demo-try-alerts, amendment 2026-10-06).
 *
 * A demo visitor is anonymous by design, and entering a demo signs the browser
 * in as the minted shop's generated owner, so neither a session nor an account
 * can say "this is Aaron" at the moment the alert fires. What can is a secret
 * only he holds: `DEMO_QUIET_KEY`. Opening `/api/demo/quiet?key=<key>` once in
 * a browser leaves this cookie behind, and `enterDemoAction` skips the founder
 * alert and the funnel event for any entry that carries it. His own clicks are
 * neither news nor a prospect.
 *
 * **The key opens nothing else.** It used to be the onboard setup key, the
 * standing credential that created every shop; that key is retired (ADR
 * 20261009-single-use-setup-links) and this one can only keep a browser's demo
 * tries quiet. So a leaked copy costs the founder some alerts, never a shop.
 *
 * The cookie holds an HMAC of the key, never the key. And because it is
 * derived from the key, rotating `DEMO_QUIET_KEY` unmarks every browser at
 * once. With no key configured nothing can be marked, and every demo try
 * alerts as before.
 */

/** The query parameter the marking link carries. Redacted from telemetry (`capability-urls.ts`). */
export const QUIET_DEMO_PARAM = "key";

/** The cookie a marked browser carries. Host-only, like every cookie here (`cookie-scope.test.ts`). */
export const QUIET_DEMO_COOKIE = "diveday_quiet_demo";

/** Browsers cap a cookie's life near 400 days; ask for that and re-open the link when it lapses. */
export const QUIET_DEMO_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** The fixed key a non-production run accepts when none is configured. */
export const DEV_DEMO_QUIET_KEY = "diveday-dev-quiet-demo-key-not-for-production";

/**
 * Shorter than this and the configured value is treated as unset: a key a
 * person could guess in a rate-limited afternoon is no key at all.
 */
export const MIN_DEMO_QUIET_KEY_LENGTH = 24;

type Env = Readonly<Record<string, string | undefined>>;

/** The key this deployment accepts, or null when nothing can be marked. */
export function demoQuietKey(env: Env = process.env): string | null {
  const configured = env.DEMO_QUIET_KEY?.trim();
  if (configured) {
    // Written in this public repository, so it is no key at all.
    if (configured === DEV_DEMO_QUIET_KEY) return null;
    return configured.length >= MIN_DEMO_QUIET_KEY_LENGTH ? configured : null;
  }
  return env.NODE_ENV === "production" ? null : DEV_DEMO_QUIET_KEY;
}

/**
 * Whether a request-supplied value is the key. Anything that is not a string
 * is not. Compared as fixed-length digests in constant time, so neither the
 * length nor a prefix of the key leaks through timing.
 */
export function isDemoQuietKey(candidate: unknown, env: Env = process.env): boolean {
  const key = demoQuietKey(env);
  if (!key || typeof candidate !== "string" || !candidate) return false;
  return timingSafeEqual(digest(candidate), digest(key));
}

/** The value a marked browser holds on this deployment, or null when nothing can be marked. */
export function quietDemoToken(env: Env = process.env): string | null {
  const key = demoQuietKey(env);
  if (!key) return null;
  return createHmac("sha256", key).update("diveday quiet demo device v1").digest("base64url");
}

/** Whether a cookie value marks this browser as the founder's. */
export function isQuietDemoDevice(candidate: unknown, env: Env = process.env): boolean {
  const token = quietDemoToken(env);
  if (!token || typeof candidate !== "string" || !candidate) return false;
  // Compared as fixed-length digests: a cookie of the token's length in
  // multibyte characters would otherwise reach `timingSafeEqual` at a
  // different byte length, and throw out of the demo instead of saying no.
  return timingSafeEqual(digest(candidate), digest(token));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
