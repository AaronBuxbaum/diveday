import { createHash, randomBytes } from "node:crypto";

/**
 * The shared primitive behind every URL-is-the-credential surface: waiver
 * links, booking capabilities, and calendar feeds. Extracted so a new bearer
 * surface reuses the same generation and storage discipline rather than
 * re-deriving it (and quietly picking a shorter token or a reversible digest).
 *
 * 256 bits from a CSPRNG, base64url so it survives a URL path segment
 * untouched. Only the digest is ever stored: a database reader — a backup, a
 * support query, a leaked dump — must not come away holding usable
 * credentials.
 *
 * A plain SHA-256 rather than an HMAC or a password hash is deliberate. The
 * token is full-entropy random, not user-chosen, so there is no dictionary to
 * attack and no work factor worth paying on a hot verify path; and keying the
 * digest would make every stored row unreadable if the key rotated, which for
 * a credential the shop cannot re-issue silently (a subscribed calendar just
 * stops updating) is a worse failure than the one it prevents.
 */
export function createBearerToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashBearerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
