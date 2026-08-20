import { createHash, randomBytes } from "node:crypto";

/**
 * The shared primitive behind every URL-is-the-credential surface: waiver
 * links, booking capabilities, and calendar feeds. Extracted so a new bearer
 * surface reuses the same generation and storage discipline rather than
 * re-deriving it (and quietly picking a shorter token or a reversible digest).
 *
 * ## Use this for
 *
 * A machine-generated credential carried in a URL, where possession *is* the
 * authorization: `/waivers/[token]`, `/ready/[token]`, `/calendar/[token]`.
 *
 * ## Do not use this for
 *
 * - **Anything a human chooses or types.** A password or a short code has
 *   nowhere near 256 bits of entropy, so a single unsalted SHA-256 is the wrong
 *   digest for it — those need a KDF (`src/db/user-accounts.ts` uses bcrypt).
 * - **A shared secret two systems both hold** (a webhook signing key). That
 *   wants an HMAC over the payload, not a stored digest of the key.
 *
 * ## What this deliberately does not decide
 *
 * Lifetime is the caller's, and the three current callers disagree sharply for
 * good reasons — so do not copy one's policy into a new surface without
 * re-deriving it. A booking capability expires on a schedule tied to its trip;
 * a waiver link lives seven days and is *reused* while it lasts, superseded
 * only when it cannot be (ADR 20260820-waiver-links-are-reused-not-reissued);
 * a calendar feed never
 * expires at all, because a lapsed one would stop a captain's calendar updating
 * silently (20260730-calendar-feed-subscriptions). Each owns its own
 * `expiresAt`/`revokedAt` columns and its own verify-time checks. All this
 * module promises is: enough entropy that the token cannot be guessed, and a
 * stored form that cannot be replayed by whoever reads the database.
 *
 * That last promise is about *this* module's output, and one caller keeps a
 * second copy beside it. `waiver_records.token_sealed` holds the same token
 * sealed under `SECRET_ENCRYPTION_KEY` for as long as the link is live, because
 * a shop that copies a link and then texts it must not be handing out two URLs
 * of which only the second works. The digest is still what every lookup
 * matches, the sealed copy is nulled the moment the link is spent, and opening
 * it needs a key that is not in the database — so a reader of a dump still
 * comes away with nothing replayable. If you add a bearer surface, start from
 * hash-only; reach for a sealed copy only when the surface genuinely has to
 * hand the *same* credential over twice, and write down why.
 *
 * 256 bits from a CSPRNG, base64url so it survives a URL path segment
 * untouched. The digest is all this module ever asks you to store (the one
 * exception, and its bounds, are above): a database reader — a backup, a
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
