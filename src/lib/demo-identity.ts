/**
 * Identity for a freshly-minted demo shop (ADR 20260724-per-visitor-demo-shops).
 *
 * Framework-free and unit-testable. Two independent uniqueness needs drive the
 * shape:
 *   - The shop `slug` is globally unique, and two visitors can mint demos at the
 *     same moment, so the slug carries a random suffix.
 *   - `user_accounts.email` is globally unique, so the staff emails are
 *     namespaced under the (unique) slug — `dana@<slug>.demo.invalid`. The
 *     `.invalid` TLD (RFC 2606) is guaranteed non-routable, so a demo address can
 *     never accidentally receive real mail.
 *
 * Randomness comes from `crypto`, not `Math.random`; nothing here reads the
 * clock (the `src/lib` clock rule), so it needs no `now` and stays deterministic
 * to test by stubbing `crypto`.
 */

/**
 * The reserved, non-routable namespace every demo account's email sits in —
 * either exactly this domain (the canonical `blue-mantis` fixture's
 * `DEV_STAFF_LOGINS`) or a per-shop subdomain of it (`<slug>.demo.invalid`,
 * minted below).
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so no real shop
 * can ever own an address in here: onboarding and staff invites both mail the
 * address they are given, and an address under `.invalid` would silently drop
 * every message. That property is what lets `src/lib/demo-bypass.ts` treat
 * "the account lives in this namespace" as a second, independent condition on
 * the demo sign-in bypass — one that a flipped `shops.is_demo` column alone
 * cannot satisfy.
 */
export const DEMO_EMAIL_DOMAIN = "demo.invalid";

/**
 * Whether an account email sits in the reserved demo namespace — the exact
 * domain, or any subdomain of it. Anchored so a lookalike registrable domain
 * (`demo.invalid.example.com`, `notdemo.invalid`) does not match.
 */
export function isDemoAccountEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domain === DEMO_EMAIL_DOMAIN || domain.endsWith(`.${DEMO_EMAIL_DOMAIN}`);
}

const ADJECTIVES = [
  "coral",
  "azure",
  "cobalt",
  "reef",
  "tidal",
  "sunlit",
  "drifting",
  "silver",
  "emerald",
  "pelagic",
  "shallow",
  "kelp",
  "lagoon",
  "current",
  "anchor",
  "compass",
] as const;

const NOUNS = [
  "cove",
  "reef",
  "lagoon",
  "current",
  "shoals",
  "channel",
  "atoll",
  "harbor",
  "point",
  "bank",
  "bay",
  "sound",
  "narrows",
  "pass",
  "shallows",
  "drop",
] as const;

/** A cryptographically-random integer in [0, max). */
function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Rejection-free modulo is fine here: the bias across a 16-element table is
  // immaterial for picking a demo name.
  return buf[0] % max;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

/** Short lowercase-hex token from a UUID, for slug uniqueness. */
function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export type DemoShopIdentity = {
  /** Display name, e.g. "Coral Cove Divers". */
  name: string;
  /** Globally-unique URL slug, e.g. "coral-cove-divers-a1b2c3". */
  slug: string;
  /** Namespaced, globally-unique staff email, e.g. emailFor("dana"). */
  emailFor: (localPart: string) => string;
};

/**
 * Mint an identity for one demo shop. The suffix makes the slug (and therefore
 * every derived email) collision-safe under concurrent minting; callers should
 * still treat a `23505` on insert as "regenerate and retry" for total safety.
 */
export function generateDemoShopIdentity(): DemoShopIdentity {
  const adjective = pick(ADJECTIVES);
  const noun = pick(NOUNS);
  const suffix = randomSuffix();
  const slug = `${adjective}-${noun}-divers-${suffix}`;
  return {
    name: `${capitalize(adjective)} ${capitalize(noun)} Divers`,
    slug,
    emailFor: (localPart) => `${localPart}@${slug}.${DEMO_EMAIL_DOMAIN}`,
  };
}
