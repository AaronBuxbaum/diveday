import { deriveLabelKey, signPayload, tagMatches } from "./signed-token";
import { isUuid } from "./uuid";

/**
 * **A booking link's token is computed from its row, never stored** (ADR
 * 20261104-derived-booking-link-tokens, issue #2711).
 *
 * The token is `c<v>.<id>.<tag>`, exactly 69 characters:
 *
 * - `v`: the key version, one digit 1 to 9. The row keeps the same number in
 *   `booking_capabilities.key_version`, and a token whose version is not its
 *   row's is refused.
 * - `id`: the row's uuid as 22 unpadded base64url characters. Only the
 *   canonical spelling parses: the last character carries four spare bits,
 *   which must be zero, so one row has exactly one token string.
 * - `tag`: HMAC-SHA256 under the version's key over
 *   `"booking-capability\0" || v || "\0" || id || "\0" || purpose`, all 256 bits
 *   in 43 characters. The purpose is in the MAC, so a `confirm` token never
 *   verifies as `readiness` even if a query forgot to filter on it.
 *
 * ## Keys and versions
 *
 * - **v1** is HKDF-SHA256 of `AUTH_SECRET` under the label
 *   `diveday-booking-capability-v1`. It signs only while `BOOKING_LINK_SECRET`
 *   is unset, and verifies only while `BOOKING_LINK_SECRET_PREVIOUS` is unset:
 *   v1 holds the "previous" slot until the first real rotation fills it, so
 *   v1 links can be retired without rotating `AUTH_SECRET` (which also signs
 *   every staffer out). Issuing never re-sends a row signed under anything but
 *   the signing version, so old rows drain as their bookings are mailed.
 * - **v2 and later** come from `BOOKING_LINK_SECRET`, whose value carries its
 *   own version: `v<n>:<secret>`, n from 2 to 9, the secret at least 32 bytes.
 *   The key is HKDF-SHA256 of the secret under `diveday-booking-capability-v<n>`.
 * - **Rotation** is two edits made together: move the current value, prefix and
 *   all, into `BOOKING_LINK_SECRET_PREVIOUS`, and set `BOOKING_LINK_SECRET` to
 *   `v<n+1>:<new secret>`. New rows sign under n+1; rows signed under n keep
 *   verifying through the previous key until they expire. Because the version
 *   travels inside the value, a value moved between the two variables can never
 *   be read under the wrong number. Only one previous key is held: a second
 *   rotation kills rows still on the version before last. Dropping
 *   `_PREVIOUS` (a leaked key) kills that version's links at once; the next send
 *   to each booking mints a fresh row.
 * - **Versions stop at 9.** The ninth version is the last this format can
 *   carry; the rotation after it needs a new token shape.
 *
 * ## What is refused
 *
 * A secret under 32 bytes, at every version; a `BOOKING_LINK_SECRET` (or
 * `_PREVIOUS`) whose secret is `AUTH_SECRET` itself; and the development fallback for
 * `AUTH_SECRET` anywhere that could be production (`NODE_ENV=production`,
 * `VERCEL_ENV` set, or a `DATABASE_URL` that is not on this machine). A
 * `BOOKING_LINK_SECRET` that is set but malformed makes signing throw, loudly,
 * rather than fall back to v1. Verifying never throws: a version with no usable
 * key answers null, the same as a forged tag.
 */

/** The string a dev or e2e run signs with when `AUTH_SECRET` is unset (`auth-secret.ts`). */
const DEV_AUTH_SECRET = "diveday-dev-secret-not-for-production";
const MIN_SECRET_BYTES = 32;
const TOKEN_LENGTH = 69;
const TOKEN_SHAPE = /^c([1-9])\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const VERSIONED_SECRET = /^v([2-9]):(.*)$/s;

export type BookingLinkKeyring = {
  /** The version new rows are signed under. Throws when `BOOKING_LINK_SECRET` is set but unusable. */
  signingVersion(): number;
  /** The key for one version, or null when this deployment holds none for it. */
  keyFor(version: number): Buffer | null;
};

type Env = Readonly<Record<string, string | undefined>>;

/** Where a development secret must never sign: anything that could be a real deployment. */
function devSecretAllowed(env: Env): boolean {
  if (env.NODE_ENV === "production") return false;
  if (env.VERCEL_ENV) return false;
  const url = env.DATABASE_URL;
  if (!url) return true;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

function longEnough(secret: string): boolean {
  return Buffer.byteLength(secret, "utf8") >= MIN_SECRET_BYTES;
}

function v1Root(env: Env): string | null {
  const secret = env.AUTH_SECRET ?? (env.NODE_ENV === "production" ? undefined : DEV_AUTH_SECRET);
  if (!secret || !longEnough(secret)) return null;
  if (secret === DEV_AUTH_SECRET && !devSecretAllowed(env)) return null;
  return secret;
}

type Versioned = { version: number; secret: string };

/** `v<n>:<secret>`, or an error naming what is wrong (never the value). */
function parseVersioned(name: string, value: string): Versioned | Error {
  const match = VERSIONED_SECRET.exec(value);
  if (!match) return new Error(`${name} must be "v<2-9>:<secret>"`);
  const secret = match[2] ?? "";
  if (!longEnough(secret)) return new Error(`${name}'s secret is under ${MIN_SECRET_BYTES} bytes`);
  return { version: Number(match[1]), secret };
}

/** The deployment's booking-link keys, read from `env`. Pure: pass a record to test it. */
export function bookingLinkKeyring(env: Env): BookingLinkKeyring {
  const keys = new Map<number, Buffer>();
  const root = v1Root(env);
  if (root) keys.set(1, deriveLabelKey(root, "diveday-booking-capability-v1"));

  let signing: number | Error = 1;
  const currentValue = env.BOOKING_LINK_SECRET;
  if (currentValue) {
    const current = parseVersioned("BOOKING_LINK_SECRET", currentValue);
    if (current instanceof Error) signing = current;
    else {
      keys.set(
        current.version,
        deriveLabelKey(current.secret, `diveday-booking-capability-v${current.version}`),
      );
      signing = current.version;
      if (current.secret === env.AUTH_SECRET)
        signing = new Error("BOOKING_LINK_SECRET must not be AUTH_SECRET");
      const previousValue = env.BOOKING_LINK_SECRET_PREVIOUS;
      if (previousValue) {
        // v1 holds the previous slot until the first real rotation fills it.
        keys.delete(1);
        const previous = parseVersioned("BOOKING_LINK_SECRET_PREVIOUS", previousValue);
        // A previous key at or above the current version is a botched rotation:
        // refuse to sign until it is fixed rather than guess which is newer.
        if (previous instanceof Error) signing = previous;
        else if (previous.version >= current.version)
          signing = new Error("BOOKING_LINK_SECRET_PREVIOUS must carry a lower version");
        else if (previous.secret === env.AUTH_SECRET)
          signing = new Error("BOOKING_LINK_SECRET_PREVIOUS must not be AUTH_SECRET");
        else
          keys.set(
            previous.version,
            deriveLabelKey(previous.secret, `diveday-booking-capability-v${previous.version}`),
          );
      }
    }
  }

  return {
    signingVersion() {
      if (signing instanceof Error) throw signing;
      if (!keys.has(signing))
        throw new Error("No booking-link key: set AUTH_SECRET (32+ bytes) or BOOKING_LINK_SECRET");
      return signing;
    },
    keyFor(version) {
      return keys.get(version) ?? null;
    },
  };
}

let cached: { fingerprint: string; keyring: BookingLinkKeyring } | null = null;

/** The keyring for `process.env`, rebuilt only when one of the variables it reads changes. */
export function deploymentKeyring(): BookingLinkKeyring {
  const env = process.env;
  const fingerprint = [
    env.AUTH_SECRET,
    env.BOOKING_LINK_SECRET,
    env.BOOKING_LINK_SECRET_PREVIOUS,
    env.NODE_ENV,
    env.VERCEL_ENV,
    env.DATABASE_URL,
  ].join("\0");
  if (cached?.fingerprint !== fingerprint) {
    cached = { fingerprint, keyring: bookingLinkKeyring(env) };
  }
  return cached.keyring;
}

/** A row's uuid as its 22-character token segment. */
export function encodeCapabilityId(uuid: string): string {
  if (!isUuid(uuid)) throw new Error("encodeCapabilityId: not a uuid");
  return Buffer.from(uuid.replaceAll("-", ""), "hex").toString("base64url");
}

/** The uuid a 22-character segment spells, or null for anything but the one canonical spelling. */
export function decodeCapabilityId(segment: string): string | null {
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.length !== 16 || bytes.toString("base64url") !== segment) return null;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function tagFor(key: Buffer, version: number, idSegment: string, purpose: string): string {
  return signPayload(key, `booking-capability\0${version}\0${idSegment}\0${purpose}`);
}

/**
 * The token for one row. Throws when this deployment holds no key for the
 * row's version; issuing is the only caller, and it rotates such a row first.
 */
export function bookingLinkToken(
  row: { id: string; keyVersion: number; purpose: string },
  keyring: BookingLinkKeyring = deploymentKeyring(),
): string {
  const key = keyring.keyFor(row.keyVersion);
  if (!key) throw new Error(`No booking-link key for version ${row.keyVersion}`);
  const idSegment = encodeCapabilityId(row.id);
  return `c${row.keyVersion}.${idSegment}.${tagFor(key, row.keyVersion, idSegment, row.purpose)}`;
}

/**
 * **The one door from a presented token to a row id.** Shape, known version,
 * canonical id and a constant-time tag check, all before any database work:
 * null for anything else, and never a throw, whatever `token` is. A real row id
 * under a wrong tag is refused here, so walking ids costs no query and says
 * nothing about which exist.
 *
 * The caller must still require the row's `purpose` and `key_version` to be
 * the ones returned (`src/db/booking-capabilities.ts` does, for every lookup).
 */
export function parseVerifiedCapabilityToken(
  token: unknown,
  purpose: string,
  keyring: BookingLinkKeyring = deploymentKeyring(),
): { id: string; version: number } | null {
  if (typeof token !== "string" || token.length !== TOKEN_LENGTH) return null;
  const match = TOKEN_SHAPE.exec(token);
  if (!match) return null;
  const version = Number(match[1]);
  const idSegment = match[2] ?? "";
  const tag = match[3] ?? "";
  const key = keyring.keyFor(version);
  if (!key) return null;
  const id = decodeCapabilityId(idSegment);
  if (!id) return null;
  if (!tagMatches(tag, tagFor(key, version, idSegment, purpose))) return null;
  return { id, version };
}
