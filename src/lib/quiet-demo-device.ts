import { createHmac, timingSafeEqual } from "node:crypto";
import { onboardSetupKey } from "./onboard-setup-key";

/**
 * **A browser the founder has marked as his own, so his demo tries stay out
 * of his inbox** (docs ADR 20260805-demo-try-alerts, amendment 2026-10-06).
 *
 * A demo visitor is anonymous by design, and entering a demo signs the browser
 * in as the minted shop's generated owner, so neither a session nor an account
 * can say "this is Aaron" at the moment the alert fires. What can is a secret
 * only he holds: the onboard setup key (`onboard-setup-key.ts`), the standing
 * credential that creates every shop and is never sent to one. Opening
 * `/api/demo/quiet?setup=<key>` once in a browser leaves this cookie behind,
 * and `enterDemoAction` skips the founder alert and the funnel event for any
 * entry that carries it — his own clicks are neither news nor a prospect.
 *
 * The cookie holds an HMAC of the key, never the key: reading it off a
 * borrowed laptop opens no shop. And because it is derived from the key,
 * rotating `ONBOARD_SETUP_KEY` unmarks every browser at once. With no key
 * configured nothing can be marked, and every demo try alerts as before.
 */

/** The cookie a marked browser carries. Host-only, like every cookie here (`cookie-scope.test.ts`). */
export const QUIET_DEMO_COOKIE = "diveday_quiet_demo";

/** Browsers cap a cookie's life near 400 days; ask for that and re-open the link when it lapses. */
export const QUIET_DEMO_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

type Env = Readonly<Record<string, string | undefined>>;

/** The value a marked browser holds on this deployment, or null when nothing can be marked. */
export function quietDemoToken(env: Env = process.env): string | null {
  const key = onboardSetupKey(env);
  if (!key) return null;
  return createHmac("sha256", key).update("diveday quiet demo device v1").digest("base64url");
}

/** Whether a cookie value marks this browser as the founder's. */
export function isQuietDemoDevice(candidate: unknown, env: Env = process.env): boolean {
  const token = quietDemoToken(env);
  if (!token || typeof candidate !== "string" || candidate.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
}
