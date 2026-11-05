/**
 * **The shape of a booking link token, and nothing else** (ADR
 * 20261104-derived-booking-link-tokens): `c<version>.<22-character id>.<43-character tag>`,
 * 69 characters. Pure and dependency-free, so a client component, the service
 * worker and a server action can all pre-check a token before handing it on.
 * A token that matches proves nothing: only `parseVerifiedCapabilityToken`
 * (`src/lib/booking-link-token.ts`) checks the tag.
 *
 * Every shape check of a booking link must use this, never a hand-written
 * base64url pattern: the old 43-character hashed token had no dots, and checks
 * written for it silently refuse every derived link (issue #2711).
 */
export const BOOKING_LINK_TOKEN_SHAPE = /^c([1-9])\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

/** Does this look like a booking link token? Never throws. */
export function looksLikeBookingLinkToken(value: unknown): value is string {
  return typeof value === "string" && BOOKING_LINK_TOKEN_SHAPE.test(value);
}
