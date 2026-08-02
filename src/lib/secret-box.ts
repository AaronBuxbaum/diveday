import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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
 * strings under one key, and callers treat "cannot open" as
 * "this shop has no working credential" rather than a fatal error — a rotated
 * or mis-set key degrades the courtesy channel to SMS instead of taking down
 * the reminder cron.
 */

/** Version prefix, so a future scheme change can be told apart from this one rather than guessed at. */
const SCHEME = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type SecretKey = Buffer;

export type SecretKeyResult =
  | { status: "ok"; key: SecretKey }
  | { status: "unset" }
  /** Returns a code, never a sentence — the UI picks the words (ADR 20260731-domain-layer-copy-leaks). */
  | { status: "invalid"; reason: "not_base64" | "wrong_length" };

/**
 * The application's secret-sealing key, read from `SECRET_ENCRYPTION_KEY` as
 * 32 base64 bytes (`openssl rand -base64 32`).
 *
 * Absent is a legitimate state, not an error: DiveDay runs perfectly well with
 * no shop having connected WhatsApp, and every caller degrades rather than
 * throwing. A *present but malformed* key is different — that is a
 * configuration mistake worth naming loudly, because it silently disables a
 * channel the operator believes they just switched on.
 */
export function secretKeyFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SecretKeyResult {
  const raw = env.SECRET_ENCRYPTION_KEY?.trim();
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

/**
 * Seal a secret for storage. Every call uses a fresh random IV, so sealing the
 * same token twice produces different ciphertext — an attacker with read access
 * to the column cannot tell which shops share a credential.
 *
 * Format is `v1.<iv>.<tag>.<ciphertext>`, each part base64url, chosen over a
 * JSON envelope so the stored value is a single opaque text column with no
 * parsing ambiguity.
 */
export function sealSecret(plaintext: string, key: SecretKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
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
