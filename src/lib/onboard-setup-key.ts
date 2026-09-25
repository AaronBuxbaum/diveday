import { createHash, timingSafeEqual } from "node:crypto";

/**
 * **The one key that opens `/onboard`** (ADR 20260925-shops-are-set-up-by-hand).
 *
 * Every shop is set up by hand for now: the onboard form renders, and its
 * action creates a shop, only for a request carrying this key. The link the
 * owner uses is `/onboard?setup=<key>` — never sent to a shop, because it is a
 * standing credential for every shop to come; the form posts the key back as a hidden field, and
 * the action checks it again, because a server action is callable by anyone
 * holding the page's action id whether or not they ever saw the form.
 *
 * **Closed unless configured.** In production an unset or short key means no
 * shop can be created by anyone — the safe failure for a door whose whole
 * point is to be shut. Outside production a fixed key keeps `pnpm dev`
 * zero-setup, the same shape as `authSecret`'s fallback.
 */

/** The query parameter the setup link carries. Redacted from telemetry (`capability-urls.ts`). */
export const ONBOARD_SETUP_PARAM = "setup";

/** The fixed key a non-production run accepts when none is configured. */
export const DEV_ONBOARD_SETUP_KEY = "diveday-dev-setup-key-not-for-production";

/**
 * The e2e fleet's fixed key (`e2e/servers.ts`), here so the refusal below can
 * name it: it is in this public repository, so it is no key at all.
 */
export const E2E_ONBOARD_SETUP_KEY = "diveday-e2e-onboard-setup-key";

/** Values anyone can read in this repository, refused however they are configured. */
const PUBLIC_KEYS = new Set([DEV_ONBOARD_SETUP_KEY, E2E_ONBOARD_SETUP_KEY]);

/**
 * Shorter than this and the configured value is treated as unset: a key a
 * person could guess in a rate-limited afternoon is no key at all.
 */
export const MIN_ONBOARD_SETUP_KEY_LENGTH = 24;

type Env = Readonly<Record<string, string | undefined>>;

/** The key this deployment accepts, or null when the door is shut. */
export function onboardSetupKey(env: Env = process.env): string | null {
  const configured = env.ONBOARD_SETUP_KEY?.trim();
  if (configured) {
    // The e2e fleet runs a production build with its own public key, which is
    // the one place a repository value is the right answer. Recognised by the
    // same pair `DIVEDAY_CLOCK` trusts: the harness flag, and no real database.
    if (configured === E2E_ONBOARD_SETUP_KEY && env.DIVEDAY_E2E === "1" && !env.DATABASE_URL) {
      return configured;
    }
    if (PUBLIC_KEYS.has(configured)) return null;
    return configured.length >= MIN_ONBOARD_SETUP_KEY_LENGTH ? configured : null;
  }
  return env.NODE_ENV === "production" ? null : DEV_ONBOARD_SETUP_KEY;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Whether a request-supplied value is the setup key. Anything that is not a
 * string — a repeated parameter, an uploaded file, nothing — is not. Compared
 * as fixed-length digests in constant time, so neither the length nor a prefix
 * of the key leaks through timing.
 */
export function isOnboardSetupKey(candidate: unknown, env: Env = process.env): boolean {
  const key = onboardSetupKey(env);
  if (!key || typeof candidate !== "string" || !candidate) return false;
  return timingSafeEqual(digest(candidate), digest(key));
}
