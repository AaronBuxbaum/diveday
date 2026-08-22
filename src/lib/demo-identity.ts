/**
 * Identity for a freshly-minted demo shop (ADR 20260724-per-visitor-demo-shops).
 *
 * Framework-free and unit-testable. Two independent uniqueness needs drive the
 * shape:
 *   - The shop `slug` is globally unique, and two visitors can mint demos at the
 *     same moment.
 *   - `user_accounts.email` is globally unique, so the staff emails are
 *     namespaced under the (unique) slug — `dana@<slug>.demo.invalid`. The
 *     `.invalid` TLD (RFC 2606) is guaranteed non-routable, so a demo address can
 *     never accidentally receive real mail.
 *
 * The slug used to carry a random hex suffix, which made a collision
 * astronomically unlikely but put `-a1b2c3` in front of every visitor — in the
 * URL they are shown, and in the demo sign-in address the banner tells them to
 * type. A demo is a sales surface, and that suffix read as a machine artifact
 * on it. It is gone; what replaces it is a name space large enough
 * ({@link DEMO_NAME_COMBINATIONS}, > 10,000) that collisions stay rare against
 * the small live minted-demo population, and a caller that regenerates on the
 * unique violation rather than pretending they cannot happen
 * (`createDemoShop`, src/db/seed.ts). Uniqueness is now the database's job,
 * enforced, instead of probability's job, assumed.
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
  "amber",
  "cerulean",
  "coastal",
  "ebbing",
  "fathom",
  "glassy",
  "harbor",
  "indigo",
  "jade",
  "leeward",
  "mangrove",
  "offshore",
  "quiet",
  "rolling",
  "sandbar",
  "seaward",
  "slack",
  "southern",
  "sunken",
  "turquoise",
  "verdant",
  "windward",
  "open",
  "lantern",
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
  "basin",
  "bight",
  "cay",
  "chute",
  "crossing",
  "deep",
  "ledge",
  "key",
  "inlet",
  "jetty",
  "kelp",
  "mooring",
  "outcrop",
  "passage",
  "pinnacle",
  "quay",
  "ridge",
  "shelf",
  "spit",
  "strait",
  "trench",
  "wall",
  "anchorage",
  "lookout",
] as const;

/**
 * The trade word a real dive shop actually puts on its sign. It is the third
 * factor that lifts the name space past 10,000 without either word list
 * growing so long it starts reaching for words no shop would use.
 */
const TRADE_NAMES = [
  "Divers",
  "Dive Co",
  "Scuba",
  "Dive Center",
  "Charters",
  "Dive Club",
  "Aquatics",
  "Dive Shop",
] as const;

/**
 * How many distinct shop names {@link generateDemoShopIdentity} can produce.
 * Pairs where the adjective and the noun are the same word ("Reef Reef Divers")
 * are re-picked rather than minted, so they are excluded from the count.
 */
export const DEMO_NAME_COMBINATIONS =
  (ADJECTIVES.length * NOUNS.length -
    ADJECTIVES.filter((word) => (NOUNS as readonly string[]).includes(word)).length) *
  TRADE_NAMES.length;

/** A cryptographically-random integer in [0, max). */
function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Rejection-free modulo is fine here: the bias across a table this small is
  // immaterial for picking a demo name, and the database — not this
  // distribution — is what actually enforces uniqueness.
  return buf[0] % max;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "Dive Co" -> "dive-co". The lists hold no other punctuation to strip. */
function slugify(words: string): string {
  return words.toLowerCase().replace(/\s+/g, "-");
}

export type DemoShopIdentity = {
  /** Display name, e.g. "Coral Cove Divers". */
  name: string;
  /** URL slug, e.g. "coral-cove-divers". */
  slug: string;
  /** Namespaced, globally-unique staff email, e.g. emailFor("dana"). */
  emailFor: (localPart: string) => string;
};

/**
 * Mint an identity for one demo shop — a name a real shop could plausibly
 * trade under, with nothing machine-generated left in it.
 *
 * The slug is *not* guaranteed unique: with {@link DEMO_NAME_COMBINATIONS}
 * names and a capped live population it collides rarely, and the caller is
 * expected to treat a `23505` on insert as "regenerate and retry" (see
 * `createDemoShop`). Every staff email derives from the slug, so a retry must
 * take a whole fresh identity — never the old name with a patched slug.
 */
/**
 * The identity a caller asks for by name, instead of one drawn at random.
 *
 * **For a visual capture, and nothing else.** `generateDemoShopIdentity` picks
 * its words at random by design — that is what makes the live demo feel like a
 * real shop rather than "Demo Shop 4" — and a screenshot of a minted shop is
 * therefore different on every run: the name sits in the staff header and the
 * slug-derived owner email sits in the dev banner above it. The first capture
 * to use a private shop (`manifest-emergency-empty`) reported as changed on the
 * very next pull request for that reason alone, which is how a baseline becomes
 * noise a reviewer waves through.
 *
 * Pinning solves it at the fixture rather than by masking the pixels, which the
 * repo refuses on principle: a masked capture cannot catch what it covers.
 *
 * The name is derived from the slug rather than taken separately, so the two
 * can never disagree — which is the invariant the random path also keeps.
 */
export function pinnedDemoShopIdentity(slug: string): DemoShopIdentity {
  return {
    name: slug.split("-").map(capitalize).join(" "),
    slug,
    emailFor: (localPart) => `${localPart}@${slug}.${DEMO_EMAIL_DOMAIN}`,
  };
}

export function generateDemoShopIdentity(): DemoShopIdentity {
  const adjective = pick(ADJECTIVES);
  // "Reef Reef Divers" is a name no shop would put on a boat. Re-pick rather
  // than accept it; the lists overlap on only a handful of words, so this
  // almost never runs twice.
  let noun = pick(NOUNS);
  while (noun === adjective) noun = pick(NOUNS);
  const trade = pick(TRADE_NAMES);
  const slug = `${adjective}-${noun}-${slugify(trade)}`;
  return {
    name: `${capitalize(adjective)} ${capitalize(noun)} ${trade}`,
    slug,
    emailFor: (localPart) => `${localPart}@${slug}.${DEMO_EMAIL_DOMAIN}`,
  };
}
