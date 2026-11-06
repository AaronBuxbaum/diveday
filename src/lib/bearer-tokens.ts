import { createHash, randomBytes } from "node:crypto";

/**
 * The shared primitive behind the stored-digest URL credentials, such as waiver links,
 * calendar feeds, and the returning-diver device value. Booking links are not
 * among them: they are derived from their row and an HMAC tag
 * (`src/lib/booking-link-token.ts`, ADR 20261104-derived-booking-link-tokens),
 * because a booking link has to be handed back the same every time it is
 * asked for, and a digest cannot be read back. Extracted so a new bearer
 * surface reuses the same generation and storage discipline rather than
 * re-deriving it (and quietly picking a shorter token or a reversible digest).
 *
 * ## Use this for
 *
 * A machine-generated credential carried in a URL, where possession *is* the
 * authorization: `/waivers/[token]`, `/calendar/[token]`.
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
 * Lifetime is the caller's, and the callers disagree sharply for good reasons
 * — so do not copy one's policy into a new surface without re-deriving it. A
 * waiver link lives seven days and is *reused* while it lasts, superseded
 * only when it cannot be (ADR 20260820-waiver-links-are-reused-not-reissued);
 * a calendar feed never
 * expires at all, because a lapsed one would stop a captain's calendar updating
 * silently (20260730-calendar-feed-subscriptions). A stored link's lifetime is
 * its purpose's record in `CAPABILITY_POLICY` (`src/lib/capabilities.ts`),
 * which `src/db/capabilities.ts` checks at verify time. All this module
 * promises is: enough entropy that the token cannot be guessed, and a
 * stored form that cannot be replayed by whoever reads the database.
 *
 * If you add a bearer surface, start from hash-only (a `capabilities`
 * purpose); when the surface genuinely has to hand the *same* credential over
 * twice, derive it from the row as booking links do, and write down why.
 *
 * 256 bits from a CSPRNG, base64url so it survives a URL path segment
 * untouched. The digest is all this module ever asks you to store: a database reader — a backup, a
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
