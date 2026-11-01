import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for third-party credentials DiveDay stores on a
 * shop's behalf (docs ADR 20260802-whatsapp-cloud-api-per-shop).
 *
 * The problem this exists for: a shop that plugs in its own WhatsApp Business
 * account hands DiveDay a Meta access token that can send messages as that
 * business. Unlike a Stripe Connect account id — a public identifier, useless
 * without DiveDay's own platform key — that token *is* the capability. A
 * database dump, a replica, or a stray backup with it in plaintext is a
 * compromise of the shop's WhatsApp presence, so it is sealed before it ever
 * reaches a column and opened only at the moment of a send.
 *
 * AES-256-GCM, from `node:crypto` rather than a dependency: it authenticates as
 * well as encrypts, so a tampered ciphertext fails to open instead of decrypting
 * to garbage that then gets sent to Meta as a bearer token.
 *
 * This is deliberately *not* a general-purpose crypto layer. It seals short
 * strings under one key (opening, during a rotation, under the one before it
 * too), and callers treat "cannot open" as
 * "this shop has no working credential" rather than a fatal error — a rotated
 * or mis-set key degrades the courtesy channel to SMS instead of taking down
 * the reminder cron.
 */

/** Version prefix, so a future scheme change can be told apart from this one rather than guessed at. */
const SCHEME = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const SECRET_KEY_VARIABLE = "SECRET_ENCRYPTION_KEY";
export const PREVIOUS_SECRET_KEY_VARIABLE = "SECRET_ENCRYPTION_KEY_PREVIOUS";

/**
 * The key that seals, and the one it replaced, which only opens.
 *
 * Rotation is two-key so that it locks nobody out. Two-factor secrets and
 * recovery-code digests are bound to this key (src/db/account-security.ts):
 * a key swapped in one step would leave every staffer who turned on two-factor
 * unable to sign in. With the old value in `SECRET_ENCRYPTION_KEY_PREVIOUS`,
 * everything sealed under it still opens, and each value is sealed under the
 * new key the next time it is written.
 */
export interface SecretKeyring {
  readonly current: Buffer;
  readonly previous: Buffer | null;
}

/** A bare key is a keyring with nothing before it. */
export type SecretKey = Buffer | SecretKeyring;

export type SecretKeyResult =
  | { status: "ok"; key: SecretKeyring }
  | { status: "unset" }
  /** Returns a code, never a sentence — the UI picks the words (ADR 20260731-domain-layer-copy-leaks). */
  | {
      status: "invalid";
      variable: typeof SECRET_KEY_VARIABLE | typeof PREVIOUS_SECRET_KEY_VARIABLE;
      reason: "not_base64" | "wrong_length";
    };

/**
 * The application's secret-sealing keyring, read from `SECRET_ENCRYPTION_KEY`
 * (and, during a rotation, `SECRET_ENCRYPTION_KEY_PREVIOUS`) as 32 base64 bytes
 * each (`openssl rand -base64 32`).
 *
 * Absent is a legitimate state, not an error: DiveDay runs perfectly well with
 * no shop having connected WhatsApp, and every caller degrades rather than
 * throwing. A *present but malformed* key is different — that is a
 * configuration mistake worth naming loudly, because it silently disables a
 * channel the operator believes they just switched on. The previous key is held
 * to the same standard: a mis-pasted one would quietly fail every value it was
 * there to open, which is the lockout the rotation exists to prevent.
 */
export function secretKeyFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SecretKeyResult {
  // Read by name, not through the constants, so `check-env-reads` sees both reads.
  const current = parseKey(env.SECRET_ENCRYPTION_KEY);
  if (current.status === "unset") return { status: "unset" };
  if (current.status === "invalid") {
    return { status: "invalid", variable: SECRET_KEY_VARIABLE, reason: current.reason };
  }
  const previous = parseKey(env.SECRET_ENCRYPTION_KEY_PREVIOUS);
  if (previous.status === "invalid") {
    return { status: "invalid", variable: PREVIOUS_SECRET_KEY_VARIABLE, reason: previous.reason };
  }
  return {
    status: "ok",
    key: {
      current: current.key,
      // The same value in both places is a rotation that has not started.
      previous: previous.status === "ok" && !previous.key.equals(current.key) ? previous.key : null,
    },
  };
}

/** A caller-supplied key, explicit absence, or the environment's validated keyring. */
export type SecretKeyResolution =
  | { status: "ok"; key: SecretKey }
  | { status: "unset" }
  | Extract<SecretKeyResult, { status: "invalid" }>;

/** Resolve at the point of use so omitted keys observe environment changes. */
export function resolveSecretKey(key: SecretKey | null | undefined): SecretKeyResolution {
  if (key !== undefined) return key === null ? { status: "unset" } : { status: "ok", key };
  return secretKeyFromEnvironment();
}

type ParsedKey =
  | { status: "ok"; key: Buffer }
  | { status: "unset" }
  | { status: "invalid"; reason: "not_base64" | "wrong_length" };

function parseKey(value: string | undefined): ParsedKey {
  const raw = value?.trim();
  if (!raw) return { status: "unset" };
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    return { status: "invalid", reason: "not_base64" };
  }
  // `Buffer.from(_, "base64")` never throws — it silently drops characters it
  // doesn't recognise — so the length check below, not the try/catch above, is
  // what actually catches a truncated or mis-pasted value. A value that decoded
  // to nothing at all was not base64 in any useful sense; anything else decoded
  // fine and is simply the wrong size.
  if (decoded.length !== KEY_BYTES) {
    return { status: "invalid", reason: decoded.length === 0 ? "not_base64" : "wrong_length" };
  }
  return { status: "ok", key: decoded };
}

/** Every key that may open a value, the sealing key first. */
export function openingKeys(key: SecretKey): Buffer[] {
  if (Buffer.isBuffer(key)) return [key];
  return key.previous ? [key.current, key.previous] : [key.current];
}

/**
 * A short, non-secret name for a key: the first 16 hex digits of its SHA-256.
 * Stored beside values the key protects, so an operator can count what still
 * depends on a previous key. Shell equivalent:
 * `printf %s "$KEY" | base64 -d | sha256sum | cut -c1-16`.
 */
export function secretKeyFingerprint(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * What one account holds under the sealing key: a sealed value to trial-open
 * (its two-factor secret) and the fingerprint of the key that hashed what
 * cannot be opened (its recovery codes), null when there are none or the key
 * was never recorded.
 */
export interface StoredSealing {
  readonly sealed: string | null;
  readonly codesKeyId: string | null;
}

/** A code, never a sentence: the deploy script picks the words. */
export type KeyringCheck =
  | { status: "ok"; checked: number }
  | {
      status: "cannot_open";
      /**
       * `previous_missing`: no previous key is set, so the current one was
       * rotated without moving the old value across (or the old one was retired
       * while accounts still needed it). `keys_do_not_open`: a previous key is
       * set and neither opens, so that one is wrong.
       */
      reason: "previous_missing" | "keys_do_not_open";
      checked: number;
      lockedOut: number;
    };

/**
 * **Whether this keyring opens what is already stored under it** (issue
 * #2999). A malformed key is refused by the build's env check; a well-formed
 * wrong one cannot be seen without the sealed data, and locks out every
 * staffer with two-factor sign-in. So the deploy hands this the stored values
 * and refuses to serve when any account would be locked out.
 *
 * Says how many accounts, never which key or what fingerprint: the result is
 * printed into a build log.
 */
export function keyringOpensStored(
  key: SecretKeyring,
  stored: readonly StoredSealing[],
): KeyringCheck {
  const known = new Set(openingKeys(key).map(secretKeyFingerprint));
  let lockedOut = 0;
  for (const account of stored) {
    const secretOpens = account.sealed === null || openSecret(account.sealed, key) !== null;
    const codesMatch = account.codesKeyId === null || known.has(account.codesKeyId);
    if (!secretOpens || !codesMatch) lockedOut += 1;
  }
  if (lockedOut === 0) return { status: "ok", checked: stored.length };
  return {
    status: "cannot_open",
    reason: key.previous ? "keys_do_not_open" : "previous_missing",
    checked: stored.length,
    lockedOut,
  };
}

/** The one key that seals. */
export function sealingKey(key: SecretKey): Buffer {
  return Buffer.isBuffer(key) ? key : key.current;
}

/**
 * Seal a secret for storage, always under the current key. Every call uses a
 * fresh random IV, so sealing the same token twice produces different
 * ciphertext — an attacker with read access to the column cannot tell which
 * shops share a credential.
 *
 * Format is `v1.<iv>.<tag>.<ciphertext>`, each part base64url, chosen over a
 * JSON envelope so the stored value is a single opaque text column with no
 * parsing ambiguity.
 */
export function sealSecret(plaintext: string, key: SecretKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SCHEME, base64url(iv), base64url(tag), base64url(ciphertext)].join(".");
}

/**
 * Open a sealed secret, or null when it cannot be opened — wrong key, tampered
 * ciphertext, a scheme this build doesn't know, or a malformed value.
 *
 * Null rather than a throw is the deliberate contract: the caller's honest
 * response to any of those is the same ("this shop has no usable credential"),
 * and distinguishing them for the caller would mostly serve an attacker probing
 * which failure they triggered.
 */
export function openSecret(sealed: string, key: SecretKey): string | null {
  return openSecretWithKeyring(sealed, key)?.plaintext ?? null;
}

/**
 * `openSecret`, also saying whether the value was sealed under the previous
 * key — a caller that can write it back re-seals it under the current one, so
 * the previous key can be retired without waiting for every row to change.
 */
export function openSecretWithKeyring(
  sealed: string,
  key: SecretKey,
): { plaintext: string; sealedWithPrevious: boolean } | null {
  const keys = openingKeys(key);
  for (const [index, candidate] of keys.entries()) {
    const plaintext = openWith(sealed, candidate);
    if (plaintext !== null) return { plaintext, sealedWithPrevious: index > 0 };
  }
  return null;
}

function openWith(sealed: string, key: Buffer): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== SCHEME) return null;
  const [, ivPart, tagPart, ciphertextPart] = parts;
  try {
    const iv = fromBase64url(ivPart);
    const tag = fromBase64url(tagPart);
    const ciphertext = fromBase64url(ciphertextPart);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    // `final()` is what verifies the GCM tag — it throws on any tampering,
    // which is exactly the check this function exists to perform.
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

function fromBase64url(value: string | undefined): Buffer {
  return Buffer.from(value ?? "", "base64url");
}
