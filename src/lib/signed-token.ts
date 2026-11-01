import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * **The three steps every signed capability here shares** (issue #3236): derive
 * a purpose-separated key from the auth secret, HMAC a payload, and compare a
 * supplied tag in constant time without ever throwing.
 *
 * Pure and Node-only. A module keeps its own label, payload format, expiry and
 * return shape; it borrows only the parts that were being hand-rolled, and
 * were each one missed guard away from a 500 on a public page.
 */

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** HKDF-SHA256 of the auth secret under a fixed per-purpose label: 32 bytes, empty salt. */
export function deriveLabelKey(authSecret: string, label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", authSecret, "", label, 32));
}

/**
 * HMAC-SHA256 of `payload`, unpadded base64url (43 characters).
 *
 * A string key is its UTF-8 bytes, a Buffer its own; the two are different keys,
 * so a caller keeps whichever form its tags were first minted with.
 */
export function signPayload(key: Buffer | string, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/**
 * Whether `supplied` is exactly `expected`, answering false rather than
 * throwing for anything that is not a tag.
 *
 * `timingSafeEqual` compares bytes and throws `RangeError` on buffers of
 * unequal length, and a character count admits multibyte UTF-8 (`é`, an emoji)
 * at the right length and the wrong byte length. So the shape comes first: a
 * non-empty string in the base64url alphabet, whose bytes are as many as the
 * expected tag's. Only then the constant-time compare.
 */
export function tagMatches(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== "string" || supplied.length === 0) return false;
  if (!BASE64URL.test(supplied)) return false;
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (suppliedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(suppliedBytes, expectedBytes);
}
