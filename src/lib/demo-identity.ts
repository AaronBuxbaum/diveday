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
    emailFor: (localPart) => `${localPart}@${slug}.demo.invalid`,
  };
}
